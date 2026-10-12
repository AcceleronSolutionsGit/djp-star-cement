import { getArchiveStats, clearAllArchives } from '../services/archive.service.js';

/**
 * Get summary of archived records across plans, masters, visits, and sales history.
 */
export async function getArchiveSummary(req, res) {
  try {
    const period = req.query.periodMonth || null;
    const stats = await getArchiveStats(period);

    res.json({
      success: true,
      summary: stats
    });
  } catch (err) {
    console.error('Error fetching archive summary:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Delete archive records (complete delete or filtered by periodMonth)
 */
export async function deleteArchives(req, res) {
  try {
    const period = req.query.periodMonth || req.body?.periodMonth || null;
    const result = await clearAllArchives(period);

    res.json({
      success: true,
      message: period
        ? `Archive data for ${period} deleted successfully.`
        : 'All historical archive data permanently deleted successfully.',
      deleted: result.deleted
    });
  } catch (err) {
    console.error('Error deleting archives:', err);
    res.status(500).json({ error: err.message });
  }
}
