import { dbAll, dbRun } from '../config/database.js';

/**
 * DealerMappingEngine evaluates dynamic rules to map dealers/RSSDs to Sales Officers (SOs).
 * Since the exact approved rules/dynamic formula are pending, this provides the scaffolding
 * to evaluate conditions such as Area matching, Dealer Type, or Priority Scores.
 */
export class DealerMappingEngine {
  constructor() {
    this.defaultRules = [
      { field: 'area', weight: 10 },
      { field: 'zone', weight: 5 }
    ];
  }

  async fetchAllDealers() {
    return await dbAll('SELECT * FROM master_dealers WHERE status = "ACTIVE"');
  }

  async fetchAllSOs() {
    return await dbAll('SELECT * FROM master_employees WHERE designation IN ("SO", "SE")');
  }

  /**
   * Evaluates a "dynamic formula" score between a dealer and an SO.
   * Higher score = better match.
   */
  evaluateMappingScore(dealer, so) {
    let score = 0;
    
    // Example dynamic rule evaluation: Match by Area
    if (dealer.area && so.region && dealer.area.toLowerCase() === so.region.toLowerCase()) {
      score += 50;
    }

    // Match by Zone
    if (dealer.zone && so.zone && dealer.zone.toLowerCase() === so.zone.toLowerCase()) {
      score += 20;
    }

    return score;
  }

  async runMappingProcess() {
    console.log('Starting Dealer-SO Mapping Process...');
    const dealers = await this.fetchAllDealers();
    const sos = await this.fetchAllSOs();

    if (sos.length === 0) {
      console.warn('No Sales Officers found in master_employees. Cannot run mapping.');
      return { success: false, message: 'No SOs found' };
    }

    let mappedCount = 0;
    let fallbackCount = 0;

    for (const dealer of dealers) {
      let bestSO = null;
      let highestScore = -1;

      for (const so of sos) {
        const score = this.evaluateMappingScore(dealer, so);
        if (score > highestScore) {
          highestScore = score;
          bestSO = so;
        }
      }

      // If score is 0, we fallback to the first available SO (just for demonstration)
      if (highestScore === 0) {
        bestSO = sos[0];
        fallbackCount++;
      }

      if (bestSO) {
        // Upsert logic for mapping
        const existingMapping = await dbAll('SELECT id FROM master_dealer_so_mapping WHERE dealer_id = ?', [dealer.id]);
        
        if (existingMapping && existingMapping.length > 0) {
          await dbRun(
            'UPDATE master_dealer_so_mapping SET so_name = ?, so_emp_code = ?, area = ?, region = ? WHERE dealer_id = ?',
            [bestSO.emp_name, bestSO.emp_code, dealer.area, dealer.zone, dealer.id]
          );
        } else {
          await dbRun(
            'INSERT INTO master_dealer_so_mapping (dealer_id, sap_code, dealer_name, area, region, so_name, so_emp_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [dealer.id, dealer.sap_code, dealer.dealer_name, dealer.area, dealer.zone, bestSO.emp_name, bestSO.emp_code]
          );
        }
        mappedCount++;
      }
    }

    console.log(`Mapping Complete. Successfully mapped ${mappedCount} dealers (${fallbackCount} via fallback).`);
    return { success: true, mappedCount, fallbackCount };
  }
}
