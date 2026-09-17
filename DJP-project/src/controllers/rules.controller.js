import { dbAll, dbRun, dbGet } from '../config/database.js';

export async function getRules(req, res) {
  try {
    const rules = await dbAll('SELECT * FROM business_rules ORDER BY id ASC');
    res.json({ rules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateRule(req, res) {
  try {
    const { rule_key, rule_value } = req.body;
    if (!rule_key || rule_value === undefined) {
      return res.status(400).json({ error: 'rule_key and rule_value are required' });
    }

    await dbRun(
      'UPDATE business_rules SET rule_value = ?, updated_at = CURRENT_TIMESTAMP WHERE rule_key = ?',
      [String(rule_value), rule_key]
    );

    const updated = await dbGet('SELECT * FROM business_rules WHERE rule_key = ?', [rule_key]);
    res.json({ message: 'Rule updated successfully', rule: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
