CAPACITY CONNECT - PATCH NOTES

This package contains the reviewed project with the fixes below.

1. Training Programs
   - Replaced the GROUP BY query with a correlated course-count subquery.
   - This avoids the ONLY_FULL_GROUP_BY error involving users.name.

2. Admin Competency Framework
   - Added organization-wide competency statistics to the Admin page.
   - Metrics include competency count, learners assessed, average assessed percentage,
     and skill gaps (below 60% of assessment total marks).

3. Assessment Management
   - Admin and Trainer assessment pages now load submission records for their attempts
     and average-score statistics.
   - Added statistics cards to the Admin assessment page.

4. Reports & Analytics
   - Summary endpoint now returns courses, published courses, learners, assessments,
     submissions, average reviewed marks, programs, competency metrics and completion.
   - Report cards now use these actual database values.

5. Notifications
   - New platform-wide notifications are created when courses, assessments, resources,
     competencies and published training programs are added.
   - A notification is also created when a course is published and when an assessment
     submission is graded.
   - Each user's read state remains independent through notification_reads.
   - A red unread-count badge is refreshed in portal navigation every 45 seconds.

6. Database compatibility
   - The backend expects resources.module_id, resource_visits, assessments.answer_key_json
     and assessment_submissions.auto_check_json.
   - database/migration-platform-fixes.sql adds these missing columns/table to an existing
     TiDB/MySQL database without deleting existing rows.
   - database/schema.sql includes these objects for new installations.

DEPLOYMENT STEPS

A. BACK UP FIRST
   Export the current capacity_connect database before applying the migration.

B. APPLY DATABASE MIGRATION
   1. Open TiDB Cloud SQL Editor.
   2. Select the capacity_connect database/schema.
   3. Open database/migration-platform-fixes.sql from this project.
   4. Run the complete script once.
   5. Confirm it completes without an error.

C. UPDATE RENDER ENVIRONMENT
   In Render > CAPACITY-CONNECT > Environment, confirm these keys exist:
   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET.
   DB_PORT should be 4000 and DB_NAME should be capacity_connect.
   JWT_SECRET must be a randomly generated secret of at least 24 characters;
   use a longer random value (32 random bytes or more). Do not put the real value
   in source code or send it in chat.

   To generate a random value locally with Node.js:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

D. DEPLOY
   Commit/push the updated project to the GitHub repository connected to Render,
   or upload these updated files to that repository. Trigger a Render deploy.

E. VERIFY
   - Open /api/health and confirm the API/database health response is successful.
   - Sign in separately as Administrator, Trainer and Trainee.
   - Check Admin Training Programs, Assessments, Competency Framework and Reports.
   - Create a test course/assessment/resource and confirm notifications appear for
     the other roles.
   - Submit an assessment as a test trainee and grade it as a trainer/admin.

IMPORTANT
- The ZIP intentionally does not contain .env or real credentials.
- Do not overwrite your Render environment values with the placeholder values in
  .env.example.
- JavaScript syntax checks passed using npm run check. A live TiDB/Render integration
  test cannot be performed from this local review environment; verify after deployment.
