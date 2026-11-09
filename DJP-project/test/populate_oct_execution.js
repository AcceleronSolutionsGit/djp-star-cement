import { pool } from '../src/config/database.js';

async function copyCvrToOct() {
  console.log('Copying CVR and Leads to October 2026...');

  // Delete any existing CVR for 2026-10
  await pool.query("DELETE FROM nontrade_customer_visit_reports WHERE period_month = '2026-10'");
  await pool.query("DELETE FROM nontrade_leads WHERE period_month = '2026-10'");
  await pool.query("DELETE FROM nontrade_site_visits WHERE period_month = '2026-10'");
  await pool.query("DELETE FROM nontrade_professional_visits WHERE period_month = '2026-10'");

  const shiftDate = (dStr) => {
    if (!dStr) return null;
    const parts = String(dStr).split('-');
    if (parts.length < 3) return null;
    const day = parts[2];
    const safeDay = Math.min(Number(day) || 1, 31);
    return `2026-10-${String(safeDay).padStart(2, '0')}`;
  };

  const [cvr] = await pool.query("SELECT * FROM nontrade_customer_visit_reports WHERE period_month = '2026-09'");
  console.log(`Found ${cvr.length} CVR records in Sep.`);
  if (cvr.length > 0) {
    const newCvr = cvr.map(c => [
      '2026-10', c.si_no, shiftDate(c.visit_date),
      c.customer_code, c.customer_name,
      c.route, c.type, c.branch, c.emp_code, c.emp_name,
      c.check_in_time, c.check_out_time, c.duration, c.visit_status,
      c.remarks, c.purpose_of_visit, c.sap_code, c.concat_id, c.bucket
    ]);
    const cvrSql = `
      INSERT INTO nontrade_customer_visit_reports (
        period_month, si_no, visit_date, customer_code, customer_name,
        route, type, branch, emp_code, emp_name,
        check_in_time, check_out_time, duration, visit_status,
        remarks, purpose_of_visit, sap_code, concat_id, bucket
      ) VALUES ?
    `;
    for (let i = 0; i < newCvr.length; i += 500) {
      await pool.query(cvrSql, [newCvr.slice(i, i + 500)]);
    }
    console.log(`Inserted ${newCvr.length} CVR records into Oct.`);
  }

  const [leads] = await pool.query("SELECT * FROM nontrade_leads WHERE period_month = '2026-09'");
  if (leads.length > 0) {
    const newLeads = leads.map(l => [
      '2026-10', l.si_no, shiftDate(l.created_on),
      l.emp_code, l.emp_name, l.lead_name, l.contact_no,
      l.destination_zone, l.status, l.remarks, l.segment
    ]);
    const leadsSql = `
      INSERT INTO nontrade_leads (
        period_month, si_no, created_on, emp_code, emp_name,
        lead_name, contact_no, destination_zone, status, remarks, segment
      ) VALUES ?
    `;
    for (let i = 0; i < newLeads.length; i += 500) {
      await pool.query(leadsSql, [newLeads.slice(i, i + 500)]);
    }
    console.log(`Inserted ${newLeads.length} leads into Oct.`);
  }

  const [sv] = await pool.query("SELECT * FROM nontrade_site_visits WHERE period_month = '2026-09'");
  if (sv.length > 0) {
    const newSv = sv.map(s => [
      '2026-10', s.si_no, shiftDate(s.created_on),
      s.emp_code, s.emp_name, s.site_name, s.destination_zone, s.remarks, s.segment
    ]);
    const svSql = `
      INSERT INTO nontrade_site_visits (
        period_month, si_no, created_on, emp_code, emp_name,
        site_name, destination_zone, remarks, segment
      ) VALUES ?
    `;
    for (let i = 0; i < newSv.length; i += 500) {
      await pool.query(svSql, [newSv.slice(i, i + 500)]);
    }
  }

  const [pv] = await pool.query("SELECT * FROM nontrade_professional_visits WHERE period_month = '2026-09'");
  if (pv.length > 0) {
    const newPv = pv.map(p => [
      '2026-10', p.si_no, shiftDate(p.created_on),
      p.emp_code, p.emp_name, p.professional_name, p.category, p.destination_zone, p.remarks, p.segment
    ]);
    const pvSql = `
      INSERT INTO nontrade_professional_visits (
        period_month, si_no, created_on, emp_code, emp_name,
        professional_name, category, destination_zone, remarks, segment
      ) VALUES ?
    `;
    for (let i = 0; i < newPv.length; i += 500) {
      await pool.query(pvSql, [newPv.slice(i, i + 500)]);
    }
  }

  console.log('Done!');
  process.exit(0);
}

copyCvrToOct().catch(err => {
  console.error(err);
  process.exit(1);
});
