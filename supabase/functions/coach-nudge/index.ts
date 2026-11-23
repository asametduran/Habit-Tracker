// The daily coaching nudge for the Today screen (src/hooks/use-coach.ts). The coach-scheduler
// function usually writes it in the morning; this answers with that copy, or writes one.
//
// POST { today: 'YYYY-MM-DD', refresh?: boolean, cachedOnly?: boolean }

import { serveCoach } from '../_shared/coach.ts';
import { nudgeSpec } from '../_shared/nudge.ts';

serveCoach(nudgeSpec);
