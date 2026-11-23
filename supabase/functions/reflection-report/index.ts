// Weekly / monthly reflections for the History screen (src/hooks/use-coach.ts). The
// coach-scheduler function writes them on Mondays and on the 1st; the app can also ask for a
// fresh one for the current window.
//
// POST { today: 'YYYY-MM-DD', range: 'week' | 'month', refresh?: boolean, cachedOnly?: boolean }

import { serveCoach } from '../_shared/coach.ts';
import { reportSpec } from '../_shared/report.ts';

serveCoach(reportSpec);
