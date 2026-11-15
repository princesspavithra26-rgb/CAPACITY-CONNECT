# CAPACITY CONNECT

CAPACITY CONNECT is a role-based capacity-building and learning management portal.

## Source structure

- `frontend/html` – home, authentication, trainee, trainer and administrator pages
- `frontend/css` – shared website styling
- `frontend/js` – browser API client and page integrations
- `backend/server.js` – Express API and static website server
- `backend/scripts` – administrator account bootstrap script
- `database/schema.sql` – MySQL database schema

## Main workflows

- Trainee: registration, login, course discovery, enrollment, course modules, learning resources, assessment submissions, feedback and progress.
- Trainer: course and module management, resource uploads and links, assessments, competency definitions, trainee progress and assessment grading.
- Administrator: user and role management, course publication, training programs, notifications, reports and platform settings.

The project uses Node.js, Express, MySQL, JWT authentication, bcrypt password hashing and role-based API authorization.

## Resource storage

Trainer and administrator resource forms accept a local file upload (25 MB maximum) or an external HTTPS/HTTP URL. Uploaded files are stored in `backend/uploads` and delivered through an authenticated API route. The uploads directory is excluded from Git so user-provided training files are not committed.
