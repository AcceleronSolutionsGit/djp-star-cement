# DJP Engine Client Presentation & Demo Guide

This guide is designed to help you confidently present the DJP (Dynamic Journey Planner) Engine to the client. It covers the technical architecture, business flows, logic handling, how the algorithm plans journeys, and provides a complete demo script.

---

## 1. Technical Knowledge & Architecture

To assure the client of the platform's stability, highlight these technical pillars:

* **Tech Stack:** The application is built on a modern, lightning-fast stack: React.js (Frontend) and Node.js/Express (Backend), powered by a highly optimized SQLite/MySQL database engine. 
* **Decoupled Business Logic:** The web platform does not hardcode the complex A/B/C/D categorizations or percentile math. Instead, it natively ingests the exact outputs of their existing Excel macros. This ensures 100% fidelity to their business rules and guarantees no mathematical discrepancies.
* **Resilient Data Pipelines:** The ingestion engine utilizes dynamic column mapping. Instead of relying on fragile fixed column positions, it intelligently reads headers to extract data, making the system highly resistant to accidental formatting changes.
* **Transactional Integrity:** Data uploads are tied to unique `batch_codes`. This allows for true surgical rollbacks—if a bad file is uploaded, the system can instantly delete those specific rows without corrupting historical data.

---

## 2. The Complete Business Flow

Explain how the system mirrors and enhances their real-world operations:

1. **Step 1: The Master Ingestion (The Foundation)**
   The MIS team uploads the 5 core pillars of data into the system: 
   * *PJP Process Trade (Visit Rules)*
   * *Dealer-SO Hierarchy (Mapping)*
   * *Prospect Dealers (New Opportunities)*
   * *Sales History (RSAR/ERP Data)*
   * *SFA Execution Feedback (Historical Audit Logs)*
2. **Step 2: The Master Data Hub (The Unified Database)**
   The engine aggregates these disjointed files into a single, searchable, unified database. This gives management instant macro-level visibility into dealer categorizations (Growing, De-growing, Churn, etc.) and required visit frequencies.
3. **Step 3: DJP Generation (The Algorithm)**
   Using the ingested rules, the system dynamically generates actual day-by-day Journey Plans for every single Sales Officer across the entire country with the click of a button.
4. **Step 4: SO Review & ASM Approval (The Workflow)**
   Sales Officers log in, view their auto-generated DJP, make localized adjustments (like swapping a date due to a dealer holiday), and submit it. The ASM then reviews and approves the finalized plan.

---

## 3. How the Journeys Are Planned & What "Generate DJP Data" Does

The most critical part of the system is the **Generate DJP Data** capability. When you click this button, the system isn't just copying data; it's running a complex planning algorithm.

### What actually happens when you click "Generate DJP Data"?
1. **Rule Extraction:** The engine queries the `Master Data Hub` for the *PJP Process Trade* rules to determine exactly how many visits a specific dealer requires from a specific SO (e.g., 2 visits per month).
2. **Hierarchy Verification:** It cross-references the *Dealer-SO Mapping* table to ensure the dealer is actively assigned to the correct SO.
3. **Algorithmic Distribution (The Planning):** The engine mathematically distributes the required visits across the working days of the cycle. If a dealer requires 2 visits in a month, the algorithm automatically spaces them out (e.g., placing one visit in Cycle 1 and the other in Cycle 2) to ensure optimal coverage without clustering.
4. **Output Generation:** It instantly creates thousands of individual "Proposed Visit" records in the database, uniquely tagged to specific dates and specific Sales Officers. This completely eliminates the manual work of an ASM trying to map out a calendar by hand.

---

## 4. Complete Client Presentation Script

**[Introduction: The Vision]**
*"Good morning. Today, I’m thrilled to show you the DJP Engine. Our core objective was to take your highly complex, rule-heavy Excel processes and digitize them into a lightning-fast, automated web platform—without disrupting the workflows your MIS team already relies on. We are moving you from manual spreadsheets to an intelligent algorithmic planner."*

**[Step 1: Master Ingestion & Decoupled Logic]**
*"We start here at the Ingestion Engine. Your MIS team will upload your core master files here. Now, a critical technical decision we made: we deliberately chose to let your Excel templates handle the heavy business rules—like your A/B/C/D percentile calculations. The DJP Engine acts as a smart ingestion layer. This means 100% of your business logic is preserved with zero translation errors. If you ever tweak a formula in Excel next year, the platform instantly adapts without needing a code rewrite. Furthermore, our engine uses dynamic column mapping, making it highly resilient to accidental formatting changes."*

**[Step 2: The Safety Net]**
*"We also built a massive safety net. If someone uploads the wrong file, they can just hit this trash icon. The system uses a unique internal batch code to surgically purge just that specific data out of the database, providing a true rollback feature without corrupting your historical data."*

**[Step 3: The Master Data Hub]**
*"Once ingested, all that disjointed Excel data flows here: into the Master Data Hub. This is your new single source of truth. As you can see, the raw data has been transformed into a unified dashboard. Your Categories like 'Growing' and 'De-growing' are highlighted. We've built advanced filtering directly into this view. You can instantly filter by Zone, Area, or Status. These dropdowns have clear, dedicated labels, and you can instantly clear them with a single click, allowing you to slice through thousands of records in milliseconds."*

**[Step 4: The Magic - Generating DJP Data]**
*"But having the data is only half the battle; the real magic is in the planning. Watch what happens when I click 'Generate DJP Data'. 

When I click this, the system’s backend algorithm kicks into gear. It reads the exact visit frequencies required for every single dealer, cross-references your SO hierarchies, and then mathematically distributes those required visits across the working days of the cycle. If a dealer needs two visits, the algorithm smartly spaces them out.

In milliseconds, it has generated thousands of individual, optimized day-to-day journey plans for every Sales Officer. It completely eliminates the manual nightmare of trying to build a calendar by hand."*

**[Step 5: The Final Workflow]**
*"From here, those generated plans flow directly to the Sales Officers. They log in, view their perfectly calculated DJP, make any minor localized tweaks—like moving a visit because a dealer is closed on a Tuesday—and hit submit. The plan goes to the ASM for final approval, creating a seamless, fully digitized, end-to-end business flow."*

**[Closing]**
*"In short, the DJP Engine gives you the speed, visibility, and algorithmic automation of a modern web app, while maintaining the absolute precision and familiarity of your existing rule-based Excel templates."*
