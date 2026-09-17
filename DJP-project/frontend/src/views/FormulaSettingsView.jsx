import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Sliders, Save, Sparkles, Check, Info } from 'lucide-react';

export default function FormulaSettingsView({ onShowToast, onRulesUpdated }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [form, setForm] = useState({
    // Section 1
    churn_months_threshold: '6',
    ntg_min_percentile: '60',
    ntg_max_share: '20',

    // Section 2
    cat_a_min: '60',
    cat_b_min: '40',
    cat_c_min: '20',

    // Section 3
    priority_weight_potential: '40',
    priority_weight_share: '20',
    priority_weight_category: '40',
    priority_weight_missed_boost: '15',

    // Section 4
    scoreb_growing: '40',
    scoreb_degrowing: '30',
    scoreb_need_to_grow: '25',
    scoreb_zero_lifter: '15',
    scoreb_churn: '10',

    // Section 5
    daily_visit_capacity: '8',
    daily_visit_capacity_asm: '4',
    daily_visit_capacity_rsm: '2',
    monthly_visit_capacity_zh: '10',

    // Section 6
    c1_start_day: '1',
    c1_end_day: '15',
    c2_start_day: '16',
    c2_end_day: '31',
    hol_sun: true,
    hol_2nd_sat: true,
    hol_4th_sat: true
  });

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await api.getRules();
      const ruleMap = {};
      (data.rules || []).forEach(r => {
        ruleMap[r.rule_key] = r.rule_value;
      });

      setForm(prev => ({
        ...prev,
        ...ruleMap
      }));
    } catch (err) {
      onShowToast('Failed to load rules from MySQL database', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const rulesArray = Object.keys(form).map(k => ({
        rule_key: k,
        rule_value: String(form[k])
      }));

      await api.updateRulesBatch(rulesArray);
      onShowToast('Rule Engine formulas updated & deployed successfully!', 'success');
      if (onRulesUpdated) onRulesUpdated();
    } catch (err) {
      onShowToast(err.message || 'Failed to save rules', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Top Banner */}
      <div className="content-card" style={{
        background: 'linear-gradient(135deg, #FFF5F5 0%, #FFFFFF 100%)',
        borderColor: '#FECACA',
        borderLeft: '4px solid var(--star-red)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <h3 style={{ color: 'var(--star-red-dark)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sliders size={20} />
              Rule Engine Formula & Scoring Configuration
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#7F1D1D', marginTop: '4px' }}>
              All parameters are dynamically configurable. Changes are saved to the Central SFA Engine and apply immediately to the next DJP plan generation.
            </p>
          </div>
          <button 
            className="btn btn-primary" 
            onClick={handleSave} 
            disabled={saving}
            style={{ padding: '10px 20px', fontSize: '0.88rem' }}
          >
            <Save size={16} />
            <span>{saving ? 'Saving...' : 'Save & Deploy Rules'}</span>
          </button>
        </div>
      </div>

      {/* Section 1: Classification */}
      <div className="content-card">
        <div className="card-title-bar">
          <div>
            <h4 className="card-title">📊 Dealer Classification Rules (Final Category)</h4>
            <p className="card-subtitle">Define thresholds for classifying dealers into Churn, Zero Lifter, Growing, De-growing, or Need to Grow.</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
          <div className="form-group">
            <label className="form-label">Churn Threshold (Consecutive Months with 0 sales)</label>
            <input
              type="number"
              className="form-control"
              value={form.churn_months_threshold}
              onChange={(e) => handleChange('churn_months_threshold', e.target.value)}
              min="1"
              max="12"
            />
            <small style={{ color: 'var(--text-muted)' }}>Last N months avg sales = 0 → Churn status</small>
          </div>

          <div className="form-group">
            <label className="form-label">Need to Grow - Min Area Percentile Potential (%)</label>
            <input
              type="number"
              className="form-control"
              value={form.ntg_min_percentile}
              onChange={(e) => handleChange('ntg_min_percentile', e.target.value)}
              min="0"
              max="100"
              step="5"
            />
            <small style={{ color: 'var(--text-muted)' }}>Area Potential Percentile ≥ this value</small>
          </div>

          <div className="form-group">
            <label className="form-label">Need to Grow - Max Counter Share (%)</label>
            <input
              type="number"
              className="form-control"
              value={form.ntg_max_share}
              onChange={(e) => handleChange('ntg_max_share', e.target.value)}
              min="0"
              max="100"
              step="5"
            />
            <small style={{ color: 'var(--text-muted)' }}>Counter Share &lt; this % → Need to Grow</small>
          </div>
        </div>
      </div>

      {/* Section 2: Sub-Categorization ABCD */}
      <div className="content-card">
        <div className="card-title-bar">
          <div>
            <h4 className="card-title">🏷️ Sub-Categorization Rules (A / B / C / D)</h4>
            <p className="card-subtitle">Based on Area Percentile Volume (PERCENTRANK.INC of dealer sales within area).</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ background: 'var(--color-success-bg)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <label className="form-label" style={{ color: '#166534' }}>Category A (Top Tier)</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>≥</span>
              <input
                type="number"
                className="form-control"
                value={form.cat_a_min}
                onChange={(e) => handleChange('cat_a_min', e.target.value)}
                min="0"
                max="100"
              />
              <span style={{ fontSize: '0.8rem', color: '#166534', fontWeight: 600 }}>%ile</span>
            </div>
          </div>

          <div style={{ background: 'var(--color-info-bg)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <label className="form-label" style={{ color: '#1E40AF' }}>Category B</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>≥</span>
              <input
                type="number"
                className="form-control"
                value={form.cat_b_min}
                onChange={(e) => handleChange('cat_b_min', e.target.value)}
                min="0"
                max="100"
              />
              <span style={{ fontSize: '0.8rem', color: '#1E40AF', fontWeight: 600 }}>%ile</span>
            </div>
          </div>

          <div style={{ background: 'var(--color-warning-bg)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <label className="form-label" style={{ color: '#92400E' }}>Category C</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>≥</span>
              <input
                type="number"
                className="form-control"
                value={form.cat_c_min}
                onChange={(e) => handleChange('cat_c_min', e.target.value)}
                min="0"
                max="100"
              />
              <span style={{ fontSize: '0.8rem', color: '#92400E', fontWeight: 600 }}>%ile</span>
            </div>
          </div>

          <div style={{ background: 'var(--color-danger-bg)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <label className="form-label" style={{ color: '#991B1B' }}>Category D (Bottom Tier)</label>
            <div style={{ fontSize: '0.82rem', color: '#991B1B', marginTop: '12px', fontWeight: 600 }}>
              Below Category C threshold
            </div>
          </div>
        </div>
      </div>

      {/* Grid for Priority Scoring and Category Lookup */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Section 3: Priority Weights */}
        <div className="content-card">
          <h4 className="card-title" style={{ marginBottom: '14px' }}>
            ⚖️ Priority Composite Score Weightages
          </h4>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label className="form-label">Score A - Potential Weight (W1)</label>
              <b style={{ color: 'var(--star-red)' }}>{form.priority_weight_potential}%</b>
            </div>
            <input
              type="range"
              min="10"
              max="70"
              value={form.priority_weight_potential}
              onChange={(e) => handleChange('priority_weight_potential', e.target.value)}
              className="form-control"
              style={{ cursor: 'pointer' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>Formula: (Dealer Potential / Max SO Potential) × W1</small>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label className="form-label">Score C - Counter Share Weight (W2)</label>
              <b style={{ color: 'var(--star-red)' }}>{form.priority_weight_share}%</b>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              value={form.priority_weight_share}
              onChange={(e) => handleChange('priority_weight_share', e.target.value)}
              className="form-control"
              style={{ cursor: 'pointer' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>Formula: PERCENTRANK(Counter Share) × W2</small>
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label className="form-label">Score B - Category Weight (W3)</label>
              <b style={{ color: 'var(--star-red)' }}>{form.priority_weight_category}%</b>
            </div>
            <input
              type="range"
              min="10"
              max="60"
              value={form.priority_weight_category}
              onChange={(e) => handleChange('priority_weight_category', e.target.value)}
              className="form-control"
              style={{ cursor: 'pointer' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>Formula: Category Lookup Score based on classification</small>
          </div>

          <div className="form-group">
            <label className="form-label">Carry-Forward Missed Visit Priority Boost</label>
            <input
              type="number"
              className="form-control"
              value={form.priority_weight_missed_boost}
              onChange={(e) => handleChange('priority_weight_missed_boost', e.target.value)}
              style={{ width: '140px' }}
            />
            <small style={{ color: 'var(--text-muted)' }}>Additional priority points added when previous visit was missed</small>
          </div>
        </div>

        {/* Section 4: Category Lookup Scores */}
        <div className="content-card">
          <h4 className="card-title" style={{ marginBottom: '14px' }}>
            📋 Category Lookup Scores (Score B)
          </h4>
          <p className="card-subtitle" style={{ marginBottom: '16px' }}>
            Points awarded for dealer classification status before weighting.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Growing</label>
              <input
                type="number"
                className="form-control"
                value={form.scoreb_growing}
                onChange={(e) => handleChange('scoreb_growing', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">De-growing</label>
              <input
                type="number"
                className="form-control"
                value={form.scoreb_degrowing}
                onChange={(e) => handleChange('scoreb_degrowing', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Need to Grow</label>
              <input
                type="number"
                className="form-control"
                value={form.scoreb_need_to_grow}
                onChange={(e) => handleChange('scoreb_need_to_grow', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Zero Lifter</label>
              <input
                type="number"
                className="form-control"
                value={form.scoreb_zero_lifter}
                onChange={(e) => handleChange('scoreb_zero_lifter', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Churn</label>
              <input
                type="number"
                className="form-control"
                value={form.scoreb_churn}
                onChange={(e) => handleChange('scoreb_churn', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grid for Capacities and Cycles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Section 5: Daily Visit Capacities */}
        <div className="content-card">
          <h4 className="card-title" style={{ marginBottom: '14px' }}>
            🚗 Daily & Monthly Role Visit Capacities
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">SO Max Daily Visits</label>
              <input
                type="number"
                className="form-control"
                value={form.daily_visit_capacity}
                onChange={(e) => handleChange('daily_visit_capacity', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">ASM Max Daily Co-Travels</label>
              <input
                type="number"
                className="form-control"
                value={form.daily_visit_capacity_asm}
                onChange={(e) => handleChange('daily_visit_capacity_asm', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">RSM Max Daily Audits</label>
              <input
                type="number"
                className="form-control"
                value={form.daily_visit_capacity_rsm}
                onChange={(e) => handleChange('daily_visit_capacity_rsm', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">ZH Max Monthly Key Visits</label>
              <input
                type="number"
                className="form-control"
                value={form.monthly_visit_capacity_zh}
                onChange={(e) => handleChange('monthly_visit_capacity_zh', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Section 6: Cycle & Holiday Config */}
        <div className="content-card">
          <h4 className="card-title" style={{ marginBottom: '14px' }}>
            📅 Planning Cycles & Working Days
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Cycle 1 Days (Start – End)</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="number"
                  className="form-control"
                  value={form.c1_start_day}
                  onChange={(e) => handleChange('c1_start_day', e.target.value)}
                />
                <span>to</span>
                <input
                  type="number"
                  className="form-control"
                  value={form.c1_end_day}
                  onChange={(e) => handleChange('c1_end_day', e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Cycle 2 Days (Start – End)</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="number"
                  className="form-control"
                  value={form.c2_start_day}
                  onChange={(e) => handleChange('c2_start_day', e.target.value)}
                />
                <span>to</span>
                <input
                  type="number"
                  className="form-control"
                  value={form.c2_end_day}
                  onChange={(e) => handleChange('c2_end_day', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <label className="form-label">Standard Holidays (Non-working days)</label>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
              <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="checkbox" checked={form.hol_sun} disabled /> Sunday (always off)
              </label>
              <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input 
                  type="checkbox" 
                  checked={form.hol_2nd_sat} 
                  onChange={(e) => handleChange('hol_2nd_sat', e.target.checked)} 
                /> 2nd Saturday
              </label>
              <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input 
                  type="checkbox" 
                  checked={form.hol_4th_sat} 
                  onChange={(e) => handleChange('hol_4th_sat', e.target.checked)} 
                /> 4th Saturday
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Section 7: Market Strategy Cards */}
      <div className="content-card">
        <h4 className="card-title" style={{ marginBottom: '14px' }}>
          🎯 Territory Market Strategy Definitions
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          <div style={{ background: 'var(--color-success-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid #BBF7D0' }}>
            <strong style={{ color: '#166534', fontSize: '0.95rem' }}>GA — Grow Aggressively</strong>
            <p style={{ fontSize: '0.8rem', color: '#166534', marginTop: '6px' }}>
              High-potential growth markets requiring aggressive dealer development and maximum visit frequency.
            </p>
          </div>

          <div style={{ background: 'var(--color-info-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid #BAE6FD' }}>
            <strong style={{ color: '#1E40AF', fontSize: '0.95rem' }}>GI — Grow Incrementally</strong>
            <p style={{ fontSize: '0.8rem', color: '#1E40AF', marginTop: '6px' }}>
              Moderate-potential markets with steady month-over-month volume expansion opportunities.
            </p>
          </div>

          <div style={{ background: 'var(--color-warning-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid #FDE68A' }}>
            <strong style={{ color: '#92400E', fontSize: '0.95rem' }}>MM — Maintain Market</strong>
            <p style={{ fontSize: '0.8rem', color: '#92400E', marginTop: '6px' }}>
              Established mature territories focusing on account retention, relationship maintenance, and steady service.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
