/**
 * Heuristic Routing Engine
 * 
 * Provides:
 * 1. Haversine distance calculation between coordinates.
 * 2. Capacitated Geographic Clustering (allocates visits to working days based on spatial proximity).
 * 3. Intra-Day TSP Heuristic Route Optimization (Nearest Neighbor + 2-Opt) to order visits 1..N.
 * 4. Heuristic Route Map generation with stop sequences, distances, and polylines.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two GPS coordinates in kilometers.
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const l1 = Number(lat1);
  const o1 = Number(lon1);
  const l2 = Number(lat2);
  const o2 = Number(lon2);
  if (isNaN(l1) || isNaN(o1) || isNaN(l2) || isNaN(o2)) return 0;
  if (l1 === 0 && o1 === 0) return 0;
  if (l2 === 0 && o2 === 0) return 0;
  if (l1 === l2 && o1 === o2) return 0;

  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(l2 - l1);
  const dLon = toRad(o2 - o1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(l1)) * Math.cos(toRad(l2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

/**
 * Optimize intra-day visit order using Nearest Neighbor + 2-Opt TSP Heuristic.
 * 
 * @param {Array<Object>} visits - list of visits scheduled for a single day
 * @returns {{ orderedVisits: Array<Object>, totalDistanceKm: number, polyline: Array<[number, number]> }}
 */
export function optimizeDayRoute(visits) {
  if (!visits || visits.length <= 1) {
    const v = (visits || []).map((item, idx) => ({
      ...item,
      sequence: idx + 1,
      distance_from_prev_km: 0,
      cumulative_distance_km: 0
    }));
    const poly = v
      .filter(item => item.latitude && item.longitude && (item.latitude !== 0 || item.longitude !== 0))
      .map(item => [item.latitude, item.longitude]);
    return { orderedVisits: v, totalDistanceKm: 0, polyline: poly };
  }

  // Separate visits with valid GPS vs without GPS
  const withGps = [];
  const withoutGps = [];

  for (const v of visits) {
    const lat = parseFloat(v.latitude || v.lat) || 0;
    const lng = parseFloat(v.longitude || v.lng) || 0;
    if (lat !== 0 && lng !== 0) {
      withGps.push({ ...v, latitude: lat, longitude: lng });
    } else {
      withoutGps.push(v);
    }
  }

  let orderedGps = [];

  if (withGps.length > 0) {
    // 1. Start with the highest priority or furthest visit as anchor
    // Sort initial pool: higher priority score first
    withGps.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

    const remaining = [...withGps];
    const tour = [remaining.shift()];

    // 2. Nearest Neighbor tour construction
    while (remaining.length > 0) {
      const current = tour[tour.length - 1];
      let nearestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const d = haversineDistanceKm(current.latitude, current.longitude, remaining[i].latitude, remaining[i].longitude);
        if (d < minDistance) {
          minDistance = d;
          nearestIdx = i;
        }
      }

      tour.push(remaining.splice(nearestIdx, 1)[0]);
    }

    // 3. 2-Opt refinement for minimal travel distance
    let improved = true;
    let iteration = 0;
    while (improved && iteration < 20 && tour.length >= 4) {
      improved = false;
      iteration++;
      for (let i = 0; i < tour.length - 2; i++) {
        for (let j = i + 2; j < tour.length; j++) {
          const d1 = haversineDistanceKm(tour[i].latitude, tour[i].longitude, tour[i + 1].latitude, tour[i + 1].longitude);
          const d2 = (j + 1 < tour.length)
            ? haversineDistanceKm(tour[j].latitude, tour[j].longitude, tour[j + 1].latitude, tour[j + 1].longitude)
            : 0;

          const dNew1 = haversineDistanceKm(tour[i].latitude, tour[i].longitude, tour[j].latitude, tour[j].longitude);
          const dNew2 = (j + 1 < tour.length)
            ? haversineDistanceKm(tour[i + 1].latitude, tour[i + 1].longitude, tour[j + 1].latitude, tour[j + 1].longitude)
            : 0;

          if (dNew1 + dNew2 < d1 + d2 - 0.01) {
            // Reverse segment from i + 1 to j
            const reversed = tour.slice(i + 1, j + 1).reverse();
            tour.splice(i + 1, reversed.length, ...reversed);
            improved = true;
          }
        }
      }
    }

    orderedGps = tour;
  }

  // 4. Group remaining non-GPS visits by route_name or block, appending them near matching route
  if (withoutGps.length > 0) {
    withoutGps.sort((a, b) => {
      const rA = a.route_name || a.block || a.area || '';
      const rB = b.route_name || b.block || b.area || '';
      return rA.localeCompare(rB);
    });
  }

  const allOrdered = [...orderedGps, ...withoutGps];
  let totalDistanceKm = 0;
  let cumulative = 0;

  for (let i = 0; i < allOrdered.length; i++) {
    const item = allOrdered[i];
    item.sequence = i + 1;

    let dist = 0;
    if (i > 0) {
      const prev = allOrdered[i - 1];
      if (item.latitude && item.longitude && prev.latitude && prev.longitude) {
        dist = haversineDistanceKm(prev.latitude, prev.longitude, item.latitude, item.longitude);
      }
    }

    item.distance_from_prev_km = dist;
    cumulative += dist;
    item.cumulative_distance_km = Math.round(cumulative * 100) / 100;
    totalDistanceKm += dist;
  }

  const polyline = allOrdered
    .filter(item => item.latitude && item.longitude && (item.latitude !== 0 || item.longitude !== 0))
    .map(item => [item.latitude, item.longitude]);

  return {
    orderedVisits: allOrdered,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    polyline
  };
}

/**
 * Cluster visits across working days using Spatial Heuristic + Capacity Constraints.
 * 
 * Rules:
 * 1. Daily visit capacity hard cap (e.g. 8 for SO, 5 for ASM, 3 for RSM).
 * 2. No same dealer on the same day.
 * 3. If a dealer has multiple visits (e.g. 2 visits), spread them across the cycle with day spacing.
 * 4. Dealers in the same geographic vicinity (or same SFA route / block) are clustered on the same day.
 * 5. Intra-day visits are sequenced using the TSP heuristic.
 * 
 * @param {Array<Object>} visitItems - all visits to schedule
 * @param {Array<string>} workingDays - list of working dates (YYYY-MM-DD)
 * @param {number} dailyCapacity - max visits per day
 * @param {Map<string, Object>} coordinatesMap - dealer code -> { lat, lng, routeName, hasCoordinates }
 * @returns {{ dayAllocations: Map<string, Array<Object>>, dayRouteMaps: Map<string, Object>, unallocated: Array<Object> }}
 */
export function clusterAndScheduleHeuristicRoutes(visitItems, workingDays, dailyCapacity, coordinatesMap = new Map()) {
  if (!visitItems || visitItems.length === 0 || !workingDays || workingDays.length === 0) {
    return { dayAllocations: new Map(), dayRouteMaps: new Map(), unallocated: visitItems || [] };
  }

  const effectiveDailyCapacity = Math.min(dailyCapacity || 8, 8);

  // Attach coordinates and route_name to each visitItem if not already attached
  for (const item of visitItems) {
    const sfaCode = (item.sfa_code || item.dealer_sfa_code || item.dealer_code || item.dealerCode || '').trim().toUpperCase();
    const sapCode = (item.sap_code || item.dealer_sap_code || '').trim().toUpperCase();

    const coord = coordinatesMap.get(sfaCode) || coordinatesMap.get(sapCode) || null;
    if (coord) {
      if (!item.latitude && coord.lat) item.latitude = coord.lat;
      if (!item.longitude && coord.lng) item.longitude = coord.lng;
      if (!item.route_name && coord.routeName) item.route_name = coord.routeName;
      item.has_coordinates = coord.hasCoordinates;
    }
    item.latitude = parseFloat(item.latitude) || 0;
    item.longitude = parseFloat(item.longitude) || 0;
  }

  // Initialize day structures
  const dayAllocations = new Map();
  const dayCentroids = new Map(); // date -> { latSum, lngSum, count }
  const dayDealers = new Map();   // date -> Set of dealer canonical keys

  for (const d of workingDays) {
    dayAllocations.set(d, []);
    dayCentroids.set(d, { latSum: 0, lngSum: 0, count: 0 });
    dayDealers.set(d, new Set());
  }

  // Group items by dealer so multi-visit instances can be spaced apart
  const dealerGroups = new Map();
  for (const item of visitItems) {
    const key = (item.dealer_code || item.dealerCode || item.sap_code || item.sfa_code || item.dealer_name || 'ITEM').toUpperCase();
    if (!dealerGroups.has(key)) dealerGroups.set(key, []);
    dealerGroups.get(key).push(item);
  }

  // Sort dealer groups:
  // 1. Dealers with coordinates first, sorted spatially by longitude + latitude
  // 2. Multi-visit dealers first (to place their spaced visits smoothly)
  // 3. Higher priority score first
  const sortedDealerKeys = Array.from(dealerGroups.keys()).sort((kA, kB) => {
    const itemsA = dealerGroups.get(kA);
    const itemsB = dealerGroups.get(kB);
    const a = itemsA[0];
    const b = itemsB[0];

    const aHasGps = a.latitude !== 0 && a.longitude !== 0 ? 1 : 0;
    const bHasGps = b.latitude !== 0 && b.longitude !== 0 ? 1 : 0;
    if (aHasGps !== bHasGps) return bHasGps - aHasGps;

    // Multi-instance dealers first so they find well-spaced clusters
    if (itemsA.length !== itemsB.length) return itemsB.length - itemsA.length;

    // Highest priority score
    const pDiff = (b.priority_score || b.totalScore || 0) - (a.priority_score || a.totalScore || 0);
    if (pDiff !== 0) return pDiff;

    // Geographic sweep: sort by latitude + longitude
    if (aHasGps && bHasGps) {
      return (a.latitude + a.longitude) - (b.latitude + b.longitude);
    }

    // Route / block name
    const rA = a.route_name || a.block || a.area || '';
    const rB = b.route_name || b.block || b.area || '';
    return rA.localeCompare(rB);
  });

  const unallocated = [];

  // Helper to calculate distance from an item to a day's current centroid
  const distanceToDay = (item, dateStr) => {
    const centroid = dayCentroids.get(dateStr);
    if (!centroid || centroid.count === 0) return 0;
    if (!item.latitude || !item.longitude) return 100; // neutral fallback distance
    const avgLat = centroid.latSum / centroid.count;
    const avgLng = centroid.lngSum / centroid.count;
    return haversineDistanceKm(item.latitude, item.longitude, avgLat, avgLng);
  };

  // Helper to check route/block match for items without GPS
  const routeMatchScore = (item, dateStr) => {
    const dayItems = dayAllocations.get(dateStr);
    if (!dayItems || dayItems.length === 0) return 0;
    const route = (item.route_name || item.block || item.area || '').toUpperCase();
    if (!route) return 5;
    const sameRouteCount = dayItems.filter(v => 
      (v.route_name || v.block || v.area || '').toUpperCase() === route
    ).length;
    return sameRouteCount > 0 ? -10 * sameRouteCount : 5;
  };

  // Schedule each dealer's visits
  for (const dealerKey of sortedDealerKeys) {
    const instances = dealerGroups.get(dealerKey);
    const assignedDaysForThisDealer = [];

    for (let instIdx = 0; instIdx < instances.length; instIdx++) {
      const item = instances[instIdx];
      let bestDay = null;
      let minCost = Infinity;

      // Candidate days: must have space (< capacity) and no same dealer
      const candidateDays = workingDays.filter(d => {
        const currentCount = dayAllocations.get(d).length;
        const hasSameDealer = dayDealers.get(d).has(dealerKey);
        return currentCount < effectiveDailyCapacity && !hasSameDealer;
      });

      if (candidateDays.length === 0) {
        // Fallback pass: allow up to hard cap of 8
        const fallbackDays = workingDays.filter(d => {
          const currentCount = dayAllocations.get(d).length;
          const hasSameDealer = dayDealers.get(d).has(dealerKey);
          return currentCount < 8 && !hasSameDealer;
        });
        if (fallbackDays.length > 0) {
          candidateDays.push(...fallbackDays);
        }
      }

      if (candidateDays.length === 0) {
        unallocated.push(item);
        continue;
      }

      // For multiple visits to the same dealer, compute ideal target day index to spread them across cycle
      const idealDayIndex = Math.floor((instIdx * workingDays.length) / instances.length);

      for (const dDate of candidateDays) {
        const dayIdx = workingDays.indexOf(dDate);
        let cost = 0;

        // 1. Spacing penalty if too close to another instance of this dealer
        for (const assignedDate of assignedDaysForThisDealer) {
          const prevIdx = workingDays.indexOf(assignedDate);
          const gap = Math.abs(dayIdx - prevIdx);
          if (gap < 2) cost += 1000; // heavy penalty for consecutive days
          else if (gap < 4) cost += 200;
        }

        // 2. Spatial proximity cost
        if (item.latitude && item.longitude) {
          const geoDist = distanceToDay(item, dDate);
          cost += geoDist; // km distance directly adds to cost
        } else {
          cost += routeMatchScore(item, dDate);
        }

        // 3. Cadence alignment bonus
        const cadenceDiff = Math.abs(dayIdx - idealDayIndex);
        cost += cadenceDiff * 2;

        if (cost < minCost) {
          minCost = cost;
          bestDay = dDate;
        }
      }

      if (bestDay) {
        dayAllocations.get(bestDay).push(item);
        dayDealers.get(bestDay).add(dealerKey);
        assignedDaysForThisDealer.push(bestDay);

        // Update day centroid
        if (item.latitude && item.longitude) {
          const c = dayCentroids.get(bestDay);
          c.latSum += item.latitude;
          c.lngSum += item.longitude;
          c.count += 1;
        }
      } else {
        unallocated.push(item);
      }
    }
  }

  // Now, for every day that has visits, optimize the intra-day sequence and compute route map!
  const dayRouteMaps = new Map();

  for (const [vDate, visits] of dayAllocations.entries()) {
    if (visits.length === 0) continue;

    const { orderedVisits, totalDistanceKm, polyline } = optimizeDayRoute(visits);
    dayAllocations.set(vDate, orderedVisits);

    dayRouteMaps.set(vDate, {
      visitDate: vDate,
      visitCount: orderedVisits.length,
      totalDistanceKm,
      hasCoordinatesCount: orderedVisits.filter(v => v.latitude && v.longitude && (v.latitude !== 0 || v.longitude !== 0)).length,
      polyline,
      stops: orderedVisits.map(v => ({
        sequence: v.sequence,
        dealerCode: v.dealer_code || v.dealerCode || v.sap_code || v.sfa_code,
        dealerSapCode: v.sap_code || v.dealer_sap_code,
        dealerSfaCode: v.sfa_code || v.dealer_sfa_code,
        dealerName: v.dealer_name || v.dealerName,
        dealerType: v.dealer_type || v.dealerType || 'DEALER',
        latitude: v.latitude,
        longitude: v.longitude,
        hasCoordinates: !!(v.latitude && v.longitude && (v.latitude !== 0 || v.longitude !== 0)),
        distanceFromPrevKm: v.distance_from_prev_km || 0,
        cumulativeDistanceKm: v.cumulative_distance_km || 0,
        routeName: v.route_name || '',
        block: v.block || v.area || '',
        grade: v.grade,
        finalCategory: v.final_category || v.finalCategory
      }))
    });
  }

  return { dayAllocations, dayRouteMaps, unallocated };
}

