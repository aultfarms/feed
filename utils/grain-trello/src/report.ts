import Table from 'cli-table3';
import type {
  CropTotal,
  GrainTotalsReport,
  ListTotal,
} from './totals.js';

const bushelFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function renderReport(report: GrainTotalsReport): string {
  const sections: string[] = [];

  if (report.lists.length === 0) {
    sections.push('No seller/buyer lists were found.');
  }

  for (const list of report.lists) {
    if (list.crops.length === 0) {
      sections.push(`${list.name}\nNo deliveries.`);
      continue;
    }

    for (const crop of list.crops) {
      sections.push(`${list.name} — ${crop.crop}\n${renderMonthlyTable(crop)}`);
    }
  }

  sections.push(`Overall totals\n${renderSummaryTable(report.lists)}`);
  return sections.join('\n\n');
}

export function formatBushels(bushels: number): string {
  return bushelFormatter.format(bushels);
}

function renderMonthlyTable(crop: CropTotal): string {
  const table = new Table({
    head: [ 'Month', 'Deliveries', 'Bushels' ],
    colAligns: [ 'left', 'right', 'right' ],
  });

  for (const monthly of crop.monthly) {
    table.push([
      monthly.month,
      String(monthly.deliveries),
      formatBushels(monthly.bushels),
    ]);
  }
  table.push([
    'Total',
    String(crop.deliveries),
    formatBushels(crop.bushels),
  ]);

  return table.toString();
}

function renderSummaryTable(lists: ListTotal[]): string {
  const table = new Table({
    head: [ 'Seller / buyer list', 'Crop', 'Deliveries', 'Bushels' ],
    colAligns: [ 'left', 'left', 'right', 'right' ],
  });

  if (lists.length === 0) {
    table.push([ 'No lists', '—', '0', formatBushels(0) ]);
  }

  for (const list of lists) {
    if (list.crops.length === 0) {
      table.push([ list.name, '—', '0', formatBushels(0) ]);
      continue;
    }

    for (const crop of list.crops) {
      table.push([
        list.name,
        crop.crop,
        String(crop.deliveries),
        formatBushels(crop.bushels),
      ]);
    }
  }

  return table.toString();
}
