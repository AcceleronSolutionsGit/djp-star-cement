# Field App API Specification: Unplanned Visits

**Document Target:** Mobile Field App (Android / iOS / Flutter / React Native)  
**Date:** 11-Oct-2026  
**Status:** Active / Production Ready  
**Scope:** Field Officers (SO / TSO) viewing their unplanned visits synced from SFA  

---

## 1. Overview & Purpose

When an officer visits a dealer that was **not scheduled in their monthly PJP (Permanent Journey Plan)** or not mapped in their assigned beat targets, the backend SFA reconciliation engine marks that visit as **Unplanned** (`is_unplanned = 1`).

This dedicated Mobile App endpoint allows the Field App to query **only** the unplanned visits belonging to the logged-in officer, filtered automatically up to **T-1 day** (yesterday).

---

## 2. Endpoint Details

| Property | Value |
| :--- | :--- |
| **HTTP Method** | `GET` |
| **Path** | `/api/app/officers/:empCode/unplanned-visits` |
| **Auth** | Bearer Token / App Session |
| **Path Parameter** | `:empCode` (e.g. `EMP001` or `SO_KOL_01`) — Officer Employee Code |
| **Data Boundary** | **Strictly capped at T-1 day (yesterday)**. Today's incomplete intraday visits are never returned. |

---

## 3. Query Parameters

All query parameters are optional:

| Parameter | Type | Default | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `month` | String | *None* | Filter by month (`YYYY-MM`) | `2026-10` |
| `startDate`| String | *None* | Filter visits starting from date (`YYYY-MM-DD`) | `2026-10-01` |
| `endDate` | String | *T-1 Day* | Filter visits up to date (`YYYY-MM-DD`). Automatically clamped to `T-1` if omitted or if a future date is supplied. | `2026-10-10` |
| `search` | String | *None* | Free text search across Dealer Name, Dealer Code, Route, or Branch/Area | `Gupta` or `WBM273` |
| `limit` | Integer| `100` | Pagination page size | `20` |
| `offset` | Integer| `0` | Pagination offset | `0` |

---

## 4. Response Contract

### Success Response (`200 OK`)

```json
{
  "success": true,
  "emp_code": "SO_KOL_01",
  "synced_till": "2026-10-10",
  "total": 3,
  "unplanned_visits": [
    {
      "id": 14205,
      "visit_date": "2026-10-09",
      "customer_code": "WBM273",
      "mapped_sap_code": "1002345",
      "customer_name": "M/S GUPTA HARDWARE & CEMENT",
      "customer_type": "DEALER",
      "route": "Barasat Main Market",
      "branch": "Kolkata North",
      "employee_code": "SO_KOL_01",
      "employee_name": "Rajesh Sharma",
      "check_in_time": "11:32 AM",
      "check_out_time": "11:58 AM",
      "duration": "26 mins",
      "visit_status": "COMPLETED",
      "purpose_of_visit": "Market Demand Assessment",
      "remarks": "Visited on urgent request of distributor.",
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    },
    {
      "id": 14218,
      "visit_date": "2026-10-08",
      "customer_code": "SDNE109",
      "mapped_sap_code": "1008761",
      "customer_name": "MAA TARA ENTERPRISE",
      "customer_type": "SUB-DEALER",
      "route": "Habra Bypass",
      "branch": "Kolkata North",
      "employee_code": "SO_KOL_01",
      "employee_name": "Rajesh Sharma",
      "check_in_time": "02:15 PM",
      "check_out_time": "02:40 PM",
      "duration": "25 mins",
      "visit_status": "COMPLETED",
      "purpose_of_visit": "Stock Verification",
      "remarks": "Ad-hoc counter check.",
      "is_unplanned": 1,
      "reason": "Dealer not on officer's plan"
    }
  ]
}
```

---

## 5. Field Descriptions

| Field | Type | Description |
| :--- | :--- | :--- |
| `success` | Boolean | `true` if request was processed successfully |
| `emp_code` | String | Officer's Employee Code |
| `synced_till` | String (`YYYY-MM-DD`)| Cutoff date up to which visits were synced and reconciled (T-1 day) |
| `total` | Integer | Total count of matching unplanned visits |
| `unplanned_visits[].id` | Integer | Unique identifier of the visit log record |
| `unplanned_visits[].visit_date`| String (`YYYY-MM-DD`) | Date the visit was executed |
| `unplanned_visits[].customer_code` | String | SFA Customer Code |
| `unplanned_visits[].mapped_sap_code` | String / null | Mapped SAP Customer Code from master dealers table |
| `unplanned_visits[].customer_name` | String | Registered business or counter name |
| `unplanned_visits[].customer_type` | String | Entity type (`DEALER`, `SUB-DEALER`, `PROSPECT`) |
| `unplanned_visits[].route` | String | Assigned route / beat name |
| `unplanned_visits[].branch` | String | Operational Area / Branch |
| `unplanned_visits[].check_in_time` | String | Check-in timestamp or time string |
| `unplanned_visits[].check_out_time` | String | Check-out timestamp or time string |
| `unplanned_visits[].duration` | String | Total visit duration |
| `unplanned_visits[].visit_status` | String | Execution state (`COMPLETED`, `VISITED`, `CANCELLED`) |
| `unplanned_visits[].remarks` | String | Feedback or notes recorded by the officer |
| `unplanned_visits[].is_unplanned` | Integer | Always `1` for this endpoint |
| `unplanned_visits[].reason` | String | Reconciliation explanation: `"Dealer not on officer's plan"` |

---

## 6. Client Code Integration Examples

### cURL

```bash
curl -X GET "https://api.yourdomain.com/api/app/officers/SO_KOL_01/unplanned-visits?month=2026-10" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

### React Native / Mobile JavaScript

```javascript
async function fetchOfficerUnplannedVisits(empCode, month = '2026-10') {
  try {
    const response = await fetch(
      `https://api.yourdomain.com/api/app/officers/${encodeURIComponent(empCode)}/unplanned-visits?month=${month}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${userAuthToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const data = await response.json();
    if (data.success) {
      console.log(`Synced Till: ${data.synced_till}`);
      console.log(`Found ${data.total} unplanned visits:`, data.unplanned_visits);
      return data.unplanned_visits;
    } else {
      throw new Error(data.error || 'Failed to fetch unplanned visits');
    }
  } catch (error) {
    console.error('Error fetching unplanned visits:', error);
    return [];
  }
}
```

### Flutter (Dart)

```dart
Future<List<dynamic>> getUnplannedVisits(String empCode, String month) async {
  final uri = Uri.parse(
    'https://api.yourdomain.com/api/app/officers/$empCode/unplanned-visits?month=$month'
  );
  final response = await http.get(uri, headers: {
    'Authorization': 'Bearer $token',
    'Accept': 'application/json',
  });

  if (response.statusCode == 200) {
    final Map<String, dynamic> body = jsonDecode(response.body);
    return body['unplanned_visits'] as List<dynamic>;
  } else {
    throw Exception('Failed to load unplanned visits: ${response.statusCode}');
  }
}
```

---

## 7. Error Responses

### 500 Internal Server Error
```json
{
  "error": "Database error details or connection timeout"
}
```
