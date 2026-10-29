import {
  getAllZonalHeadMappings,
  resolveZonalHead,
  healAllMissingZonalHeads
} from '../services/zonalHead.service.js';

/**
 * GET /api/hierarchy/zonal-heads
 * Get all configured zone to Zonal Head mappings
 */
export async function listZonalHeads(req, res) {
  try {
    const mappings = await getAllZonalHeadMappings();
    res.json({
      success: true,
      totalZones: mappings.length,
      mappings
    });
  } catch (err) {
    console.error('[listZonalHeads]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/hierarchy/zonal-heads/resolve
 * Resolve Zonal Head for a zone, area, region, or state
 */
export async function resolveZonalHeadEndpoint(req, res) {
  try {
    const { zone, region, area, dmArea, state, branch } = req.query;
    const resolved = await resolveZonalHead({ zone, region, area, dmArea, state, branch });
    res.json({
      success: true,
      ...resolved
    });
  } catch (err) {
    console.error('[resolveZonalHeadEndpoint]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/hierarchy/zonal-heads/heal
 * On-demand backfill/healing of missing Zonal Heads across master tables
 */
export async function healZonalHeadsEndpoint(req, res) {
  try {
    const result = await healAllMissingZonalHeads();
    res.json({
      success: true,
      ...result,
      message: `Healing completed: ${result.dealersHealed} dealers, ${result.mappingsHealed} mappings, ${result.targetsHealed} targets updated.`
    });
  } catch (err) {
    console.error('[healZonalHeadsEndpoint]', err);
    res.status(500).json({ error: err.message });
  }
}

