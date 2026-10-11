// ===== /api/v1/weekly-report — 周报 =====

import { Router } from 'express';
import { getOrCreateWeeklyReport, listWeeklyReports } from '../services/weekly.js';

export const weeklyRouter = Router();

weeklyRouter.get('/weekly-report', (req, res) => {
  const force = req.query.refresh === '1';
  res.json(getOrCreateWeeklyReport(force));
});

weeklyRouter.get('/weekly-reports', (req, res) => {
  res.json({ reports: listWeeklyReports() });
});
