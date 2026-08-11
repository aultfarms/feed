import debug from 'debug';
import { client, gisOAuth2, gconfig } from './core';

const info = debug('af/google#auth:info');
const trace = debug('af/google#auth:trace');

// The new switch to Google Identity Services stinks.  Tokens have lifetime of 1 hour, and
// there are no refreh tokens.  So I will track expiration and set a timeout to fix it.
//
// Since I added a call to authorize() from the load() function, which is called by client() and gisOAuth2(),
// in this file only you have to tell it NOT to call authorize when you grab the client, otherwise you get
// infinite recursion.
//
export type CheckableToken = {
  access_token: string,
  expires_in_ms: number,
  issued_at_ms: number
};
export function assertCheckableToken(t:any): asserts t is CheckableToken {
  if (typeof t !== 'object' || !t) throw new Error('ERROR: token must be an object')
  if (!t.access_token || typeof t.access_token !== 'string') throw new Error('ERROR: token must have an access_token');
  if (typeof t.expires_in_ms !== 'number') throw new Error('ERROR: token expires_in_ms must be a number');
  if (typeof t.issued_at_ms !== 'number') throw new Error('ERROR: token issued_at_ms must be a number');
}

let checkTimer: ReturnType<typeof setInterval> | null = null;
let token: CheckableToken | null = null;
async function checkTokenAndRefreshIfExpired() {
  let ms_to_expiration = -1;
  if (token) ms_to_expiration = msToTokenExpirationWith5MinBuffer(token);
  if (ms_to_expiration < 0 && !document.hidden) { // if it's going to expire in less than 5 minutes, refresh it now unless browser is not in foreground
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
      // Note the getAndSetNewTokenFromGoogle call will re-setup the interval timer
    }
    // Refresh the token, recompute ms_to_expiration
    await getAndSetNewTokenFromGoogle(); // sets global token variable
  }
  // If browser is hidden right now, then the next second check will pick it back up whenever it comes back.
}
function msToTokenExpirationWith5MinBuffer(t: CheckableToken) {
  return t.issued_at_ms + t.expires_in_ms - Date.now() - 5*60*1000;
}

let tokenRequestPromise: Promise<void> | null = null;
let time_of_last_request = 0;
async function getAndSetNewTokenFromGoogle() {
  if (tokenRequestPromise) {
    info('Already have a request in flight, awaiting that first')
    await tokenRequestPromise;
    return;  // The previous request placed token in global scope
  }
  // Store this promise in global scope so other simulateneous requests can await it.
  trace('Creating new token request promise');
  tokenRequestPromise = new Promise(async (resolve, reject) => {
    try {
      const c = await client({ skipAuthorize: true });
      if (!c) throw new Error('No Client');
      const auth = await gisOAuth2({ skipAuthorize: true });

      // If you call getAndSetNewTokenFromGoogle too quickly back-to-back, you will get a "popup_closed" error
      // and th popup window will never show.
      const time_to_wait = 7000 - (Date.now() - time_of_last_request);
      if (time_to_wait > 0) {
        info('It has been less than 7 seconds since last token request, waiting '+(time_to_wait/1000)+' seconds more before requesting new token');
        await new Promise(resolve => setTimeout(resolve, time_to_wait));
      }

      // Request the new token
      const new_token = await new Promise<CheckableToken>((resolveNewToken, rejectNewToken) => {
        const issued_at_ms = Date.now();
        const tokenClient = auth.initTokenClient({
          client_id: gconfig.clientId,
          scope: gconfig.scope,
          error_callback: err => {
            info('ERROR: received Error from tokenClient.  Error was: ', err);
            rejectNewToken(err);
          },
          callback: tokenResponse => {
            trace('tokenResponse callback called');
            if (tokenResponse && tokenResponse.access_token) {
              // gis tokenclient is supposed to set the token on GAPI automatically
              if (!c.getToken()) throw new Error('ERROR: after authenticating, GAPI client still has no token');
              info('Successfully logged in user, have access token.  It is: ', tokenResponse);
              localStorage.setItem('google-token', JSON.stringify(tokenResponse));
              resolveNewToken({
                ...tokenResponse,
                expires_in_ms: +(tokenResponse.expires_in) * 1000,
                issued_at_ms
              });
            }
          }
        });
        // This call actually fires off the request
        trace('Firing it off...');
        tokenClient.requestAccessToken(/*{ prompt: 'none' }*/);
      });
      time_of_last_request = Date.now();
      await setTokenAndScheduleExpirationCheck(new_token);
      resolve();
    } catch(e:any) {
      reject(e);
    }
  });
  await tokenRequestPromise;
  tokenRequestPromise = null; // reset the global scope
  return;
}

async function setTokenAndScheduleExpirationCheck(t: CheckableToken) {
  token = t;
  localStorage.setItem('google-token', JSON.stringify(t));
  // Make sure GAPI has the token too:
  (await client({ skipAuthorize: true })).setToken(t);
  let expiration_ms = msToTokenExpirationWith5MinBuffer(t);
  if (expiration_ms < 0) {
    info('setTokenAndScheduleExpirationCheck: token you are setting is expired, requesting new token')
    await getAndSetNewTokenFromGoogle(); // will recursively call setTokenAndScheduleExpirationCheck which will set the timeout so we can return
    return;
  }
  // Otherwise, schedule the expiration check for this token
  // Changed this to just keep a timer checking every second.
  if (!checkTimer) {
    checkTimer = setInterval(checkTokenAndRefreshIfExpired, 1000); // We're going to just check this every second instead of only when we think it is expired.
  }
}

//--------------------------------------------
// Authorize must be called before anything else
export type AuthResult = 'token_already_valid' | 'requested_new_token';
// forceReloadFromLocalStorage is useful for testing
export async function authorize(opts?: { forceReloadFromLocalStorage?: boolean }) : Promise<AuthResult> {
  const { forceReloadFromLocalStorage = false } = opts || {};
  if (token && !forceReloadFromLocalStorage) {
    info('authorize: token already valid')
    return 'token_already_valid'; // should already have setTimeout running that will refresh if needed
  }

  let needed_new_token = false;
  try {
    const t = JSON.parse(localStorage.getItem('google-token') || '');
    assertCheckableToken(t);
    info('authorize: have token in localStorage, setting it')
    // This expiration check is just to help with testing
    if (msToTokenExpirationWith5MinBuffer(t) < 0) {
      needed_new_token = true;
      info('Token in local storage is expired, setTokenAndScheduleExpirationCheck will request a new one');
    }
    await setTokenAndScheduleExpirationCheck(t);
  } catch(e) { token = null }
  if (!token) {
    needed_new_token = true;
    info('authorize: no non-expired token in memory or localStorage, requesting a new one');
    await getAndSetNewTokenFromGoogle(); // handles scheduling
  }
  if (needed_new_token) return 'requested_new_token';
  return 'token_already_valid';
};

export async function isAuthorized() {
  if (!token) return false;
  if (msToTokenExpirationWith5MinBuffer(token) < 0) return false;
  return true;
}

export async function deauthorize() {
  const c = await client({ skipAuthorize: true });
  const g = await gisOAuth2({ skipAuthorize: true });

  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  const cred = c.getToken();
  if (cred) {
    await new Promise<void>(resolve => {
      g.revoke(cred.access_token, resolve);
    });
  }
  c.setToken(null);
  token = null;
  localStorage.removeItem('google-token');
  info('Successfully deauthorized client');
}