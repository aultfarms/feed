import React from 'react';

import {connect} from '@cerebral/react';
import {state} from 'cerebral/tags';

import TagBar from './TagBar';
import Msg from './Msg';
import History from './History';
import HistorySelector from './HistorySelector';

import './TagPane.css';

export default connect({
  windowSize: state`windowSize`,
}, function TagPane(props) {
  return (
    <div className='tagpane' style={{ maxHeight: props.windowSize.orientation === 'landscape' ? '98vh' : '49vh' }}>
      <TagBar />
      <Msg />
      <HistorySelector />
      <History />
    </div>
   );
});
