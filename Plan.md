Agreed. I had the dependency backwards.

The 3D engine should be the last major pre-launch feature, not the foundation of the app. You can build almost the entire product around a canonical property/project model first, validate whether people actually value the planning workflow, and only then attack the expensive 3D problem.

The goal should be: build everything you can build yourself first, reach a usable product, then use that evidence to get the people/funding needed for 3D.

Revised development roadmap

Phase 1: Product foundation

Start with the boring-but-sacred stuff:

* Next.js + TypeScript frontend
* Node backend
* PostgreSQL
* Authentication
* User profiles
* Property projects
* File/document storage
* Project permissions
* Versioning
* Audit/history
* Background-job-ready architecture

The main object is:

PROPERTY PROJECT
├── Land
├── Requirements
├── Design
├── Documents
├── Vaasthu
├── Compliance
├── Budget
├── Construction
└── Deliverables

Even though 3D doesn’t exist yet, reserve it as a future deliverable.

Milestone: user can create and manage a property project.

⸻

Phase 2: Land intake

Build the complete property onboarding.

User provides:

* Location
* Plot dimensions
* Area
* Plot shape
* Facing
* North direction
* Road side
* Road width
* Survey/plot number
* Property type
* Existing construction
* Photos
* Documents

Support manual entry first.

Then document uploads:

* Sale deed
* Survey sketch
* Layout
* EC
* Other property documents

The project dashboard now becomes the digital record for the land.

⸻

Phase 3: AI Property Interview

This should probably be the first feature that makes the product feel special.

Instead of gigantic forms:

What are you planning to build?

User:

G+2 house for my family.

AI starts gathering requirements.

How many people will live here?
How many bedrooms?
How many cars?
Do you need a lift?
Do you want rental portions?
Any elderly family members?
Vaasthu preference?
Target construction budget?
Do you expect another floor in future?

But underneath, AI isn’t just chatting.

It’s filling:

{
  "buildingType": "residential",
  "floors": 3,
  "bedrooms": 4,
  "parking": {
    "cars": 2
  },
  "lift": false,
  "futureExpansion": true,
  "vastuPreference": "strong",
  "targetBudget": 7000000
}

AI keeps asking until required information is complete.

Then:

Your Project Brief

User reviews and approves it.

Milestone: messy human conversation becomes structured construction requirements.

That’s something you absolutely can build.

⸻

Phase 4: Planning workspace

Now create the actual planning product.

The dashboard should have something like:

OVERVIEW
LAND
REQUIREMENTS
PLANNING
VAASHTU
BUDGET
DOCUMENTS
CONSTRUCTION
3D PROPERTY 🔒

Don’t hide 3D.

Show it as:

3D Digital Twin

Available after design finalization.

It establishes where the journey is going.

⸻

Phase 5: Vaasthu engine

You can build this without touching 3D.

Represent the site geometrically in 2D:

NW │ N │ NE
───┼───┼───
 W │ C │ E
───┼───┼───
SW │ S │ SE

User can either provide a plan or later use generated planning information.

Rules are deterministic and versioned.

Output:

* entrance analysis
* kitchen
* bedrooms
* toilets
* stairs
* puja
* water
* directional analysis
* detected conflicts
* suggested changes

AI explains the rule results conversationally.

Again:

Rules calculate. AI explains.

⸻

Phase 6: Budget + BOQ engine

This is another feature you can own.

Start simpler than a professional QS package.

Inputs:

* Built-up area
* Number of floors
* Construction quality
* location
* structural assumptions
* room count
* finish level

Generate:

Project estimate

Civil                  ₹XX
Steel                  ₹XX
Cement                 ₹XX
Electrical             ₹XX
Plumbing               ₹XX
Flooring               ₹XX
Doors & Windows        ₹XX
Painting               ₹XX
Fixtures               ₹XX
Contingency            ₹XX
Estimated total        ₹XX

Then gradually introduce detailed quantities as better design information becomes available.

Keep every rate versioned by:

location + date + material + unit.

That becomes important later for construction tracking.

⸻

Phase 7: Documentation engine

This can become one of the first paid deliverables.

Generate a polished project dossier containing:

1. Property information
2. Land information
3. Owner requirements
4. Planning assumptions
5. Vaasthu analysis
6. Budget
7. Material assumptions
8. Compliance checklist
9. Construction assumptions
10. Risks / items requiring professional verification

PDF export.

Spreadsheet export for budget/BOQ.

Project JSON export for portability.

Now you already have something people could conceivably pay for without 3D.

⸻

Phase 8: Compliance / legal intelligence

This one requires more caution, but you can build the software infrastructure yourself.

Create:

Jurisdiction
    ↓
Authority
    ↓
Rule Set
    ↓
Rule
    ↓
Source
    ↓
Effective Date

Never let an LLM simply invent legal requirements.

For every result:

Setback requirement: X
Source: ___
Effective date: ___
Project value: ___
Status: PASS / FAIL / REVIEW

Start with one geography, not India.

If Hyderabad/Telangana is your launch market, encode the specific authorities/rules you decide to support first after getting them professionally verified.

Then expand.

This is one area where eventually paying a professional is money considerably better spent than asking Claude whether municipal law “feels right.”

⸻

Phase 9: Deliverables + payments

Now build the commercial engine.

User sees:

Available for your project

✓ Property Analysis
  ₹499
□ Detailed Vaasthu Report
  ₹699
□ Construction Budget
  ₹999
□ Detailed BOQ
  ₹1,999
□ Compliance Report
  ₹1,499
□ Complete Documentation
  ₹2,999
□ 3D Digital Property
  Coming later

Important architecture:

Deliverable
├── type
├── price
├── status
├── inputVersion
├── outputVersion
├── job
├── artifacts
└── payment

That prepares you for expensive asynchronous 3D generation later without redesigning commerce.

⸻

Phase 10: Construction Companion

I would actually build this before 3D.

Because you can.

Once a project has:

* budget
* BOQ
* start date
* building specification
* milestones

generate a construction schedule.

Foundation
↓
Plinth
↓
Columns
↓
Slab
↓
Masonry
↓
MEP
↓
Plaster
↓
Flooring
↓
Painting
↓
Fixtures

Every activity contains:

plannedStart
plannedEnd
dependencies
materialsRequired
estimatedCost
actualStart
actualEnd
status
progress

Now the app transforms after construction starts.

⸻

Phase 11: “What should happen this week?”

This could be one of your strongest AI features.

The AI receives actual project state.

Monday:

This week

Primary target: Complete first-floor columns.

Monday–Tuesday

Reinforcement work

Wednesday

Column shuttering

Thursday

Pre-pour checks

Friday

Concrete work

Then:

Materials required

Steel: X
Cement: X
Aggregate: X

Upcoming purchases

Order X by Wednesday because it is required next Monday.

That’s your construction copilot.

⸻

Phase 12: Expenses + material tracking

Owner records:

50 cement bags
₹21,500
Supplier XYZ

or uploads invoice.

AI extracts it.

System updates:

Planned cement      420 bags
Purchased           210
Consumed            164
Available            46
Upcoming need        82

And:

Budget       ₹70.0L
Spent        ₹18.7L
Committed     ₹3.2L
Forecast     ₹72.1L
Risk         +₹2.1L

That alone could save homeowners a ridiculous number of Excel sheets and WhatsApp messages.

⸻

Phase 13: Contractor access

Before 3D too.

Roles:

Owner

Full access.

Contractor

Can see approved:

* plans
* tasks
* specifications
* schedules
* material requirements

Contributor Contractor

Additionally:

* mark tasks complete
* upload photos
* record material delivery
* report issue

But cannot:

* change budget assumptions
* modify designs
* delete project data
* purchase deliverables

Every contractor action gets logged.

⸻

Phase 14: Weather-aware construction

Also before 3D.

Once you have the property’s location and construction schedule:

Weather forecast
       +
Construction activities
       ↓
Risk engine

Not:

31°C, cloudy.

Instead:

Rain risk Thursday

Exterior plastering is scheduled.

Potential schedule conflict detected.

The app can automatically flag upcoming weather-sensitive tasks.

That’s far more useful.

⸻

Phase 15: Site diary + progress

Owner/contractor uploads photos daily.

Each entry:

22 Sep 2026
Workers: 8
Completed:
✓ Column reinforcement
✓ Shuttering
Materials received:
• 40 cement bags
• 600 kg steel
Issues:
• Plumbing sleeve position requires confirmation
Photos: 7

AI creates the daily summary.

Weekly:

Planned progress: 38%
Reported progress: 35%

Project approximately 3 days behind current schedule.

Later computer vision can help, but initially progress should be human-confirmed.

⸻

Phase 16: Notifications

By now notifications actually have something worth saying.

Examples:

🧱 AAC blocks should be ordered within 3 days.

🌧️ Rain may affect Thursday’s exterior work.

💰 Projected construction cost has exceeded the original budget by 4%.

📸 No site progress has been recorded for three days.

📋 Contractor marked foundation work complete. Review requested.

You can initially implement:

in-app + email.

Push/mobile comes later.

And this gives you experience with asynchronous/background processing before you ever touch the expensive 3D pipeline.

⸻

THEN: Phase 17 is 3D

At this point you have an actual company-shaped product.

And importantly, 3D isn’t being asked to save the business.

You’ll already have:

Land
+
Requirements
+
Plans
+
Vaasthu
+
Budget
+
BOQ
+
Compliance
+
Documents
+
Schedule
+
Materials
+
Expenses
+
Contractors
+
Progress

All feeding one canonical project.

Then your future 3D team gets beautifully structured inputs.

                 PROPERTY MODEL
                       │
              3D GENERATION ENGINE
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        Exterior    Interior    Utilities
            └──────────┬──────────┘
                       ▼
                  Digital Twin

And that’s when your preset idea comes in:

parametric walls, windows, stairs, wardrobes, doors, furniture, fixtures, materials, etc.

AI selects/configures them.

Cloud workers assemble and validate the property.

User gets notified when complete.

⸻

What I’d actually target before seeking funding

I wouldn’t wait until all 16 phases are finished either.

Funding Prototype V1

Build:

1. Accounts + projects

2. Land intake

3. AI requirement interview

4. Project brief

5. Vaasthu framework

6. Budget estimator

7. Documentation generation

8. Basic compliance architecture

9. Deliverable/payment architecture

10. Construction schedule

11. Weekly construction copilot

12. Material procurement planner

13. Expense tracking

14. Contractor sharing

15. Site diary

Then put:

3D DIGITAL PROPERTY

In development

inside the product and build a small manually-created proof of concept only to demonstrate the vision.

You don’t need to solve automated 3D generation yourself.

That changes your funding pitch substantially

You’re no longer telling an investor:

“I have an idea but need funding because I can’t build it.”

You’re showing:

“I built the property-planning and construction platform. It already takes land through requirements, costing, documentation and construction management. Here’s the architecture for the digital twin. Capital lets us hire the architecture/3D/engineering talent required to build that final layer and professionally validate the domain systems.”

That’s a founder story with considerably more leverage.

And it fits your situation much better: use software + AI engineering, which you can already execute, to de-risk the company first. Hire/fund the specialist engineering you genuinely cannot fake later.