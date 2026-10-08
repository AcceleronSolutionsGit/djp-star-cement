import express from 'express';
import { dbRun } from '../config/database.js';

const router = express.Router();

// Inline edit of visit targets
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { so_visits, asm_visits, rsm_visits, zh_visits } = req.body;
    
    // Recalculate total_visits
    const total_visits = (so_visits || 0) + (asm_visits || 0) + (rsm_visits || 0) + (zh_visits || 0);

    await dbRun(
      `UPDATE dealer_visit_targets 
       SET so_visits = ?, asm_visits = ?, rsm_visits = ?, zh_visits = ?, total_visits = ?
       WHERE id = ?`,
      [so_visits, asm_visits, rsm_visits, zh_visits, total_visits, id]
    );

    res.json({ message: 'Visit targets updated successfully' });
  } catch (err) {
    console.error('Failed to update visit targets:', err);
    res.status(500).json({ error: 'Failed to update visit targets' });
  }
});

export default router;
