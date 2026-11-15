/* CAPACITY CONNECT – frontend/API integration */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const api = () => window.CCAPI;
  const esc = (value) => api().escapeHtml(value);
  const page = location.pathname.split('/').pop().toLowerCase();
  const user = api().getUser();
  const roleHome = { trainee: 'trainee-dashboard.html', trainer: 'trainer-dashboard.html', administrator: 'admin-dashboard.html' };
  const protectedPages = !['index.html', 'login.html', 'register.html', ''].includes(page);
  const rolePage = page.startsWith('admin-') ? 'administrator'
    : (page.startsWith('trainer-') || page === 'create-course.html') ? 'trainer'
    : (['settings.html', 'feedback.html', 'notifications.html', 'competencies.html', 'explore-courses.html', 'my-course.html', 'my-progress.html', 'assessments.html', 'resources.html', 'course-learning.html', 'resource-details.html'].includes(page)) ? 'trainee' : null;

  function toast(message, type = 'success') {
    let region = $('#ccToastRegion');
    if (!region) { region = document.createElement('div'); region.id = 'ccToastRegion'; region.className = 'cc-toast-region'; document.body.appendChild(region); }
    const item = document.createElement('div'); item.className = `cc-toast ${type}`; item.textContent = message;
    region.appendChild(item); setTimeout(() => item.remove(), 4200);
  }

  function setMessage(target, message, type = 'success') {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (el) el.innerHTML = `<div class="notice ${type}">${esc(message)}</div>`;
    else toast(message, type);
  }

  function showModal(title, fields, onSubmit, submitLabel = 'Save') {
    const overlay = document.createElement('div'); overlay.className = 'cc-modal-backdrop';
    overlay.innerHTML = `<section class="cc-modal" role="dialog" aria-modal="true">
      <div class="cc-modal-head"><h2>${esc(title)}</h2><button type="button" class="cc-close" aria-label="Close">×</button></div>
      <form class="cc-modal-form"><div class="cc-modal-fields">${fields}</div>
      <div class="cc-modal-message" aria-live="polite"></div>
      <div class="cc-modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></div></form>
    </section>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    $('.cc-close', overlay).addEventListener('click', close);
    $('[data-cancel]', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    $('.cc-modal-form', overlay).addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = $('button[type="submit"]', form);
      const message = $('.cc-modal-message', form);
      submit.disabled = true; submit.textContent = 'Saving…'; message.textContent = '';
      try { await onSubmit(new FormData(form), overlay); close(); toast('Saved successfully.'); }
      catch (error) { message.innerHTML = `<div class="notice warning">${esc(error.message)}</div>`; submit.disabled = false; submit.textContent = submitLabel; }
    });
    const first = $('input,select,textarea', overlay); if (first) first.focus();
    return overlay;
  }

  function field(label, name, type = 'text', options = {}) {
    const required = options.required ? 'required' : '';
    const placeholder = options.placeholder ? `placeholder="${esc(options.placeholder)}"` : '';
    const value = options.value !== undefined ? `value="${esc(options.value)}"` : '';
    if (type === 'textarea') return `<label class="cc-field">${esc(label)}<textarea name="${esc(name)}" ${required} ${placeholder}>${esc(options.value || '')}</textarea></label>`;
    if (type === 'select') {
      const selectedValue = options.value === undefined ? '' : String(options.value);
      const multiple = options.multiple ? 'multiple' : '';
      return `<label class="cc-field">${esc(label)}<select name="${esc(name)}" ${required} ${multiple}>${(options.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === selectedValue ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    }
    return `<label class="cc-field">${esc(label)}<input name="${esc(name)}" type="${esc(type)}" ${required} ${placeholder} ${value} ${options.min !== undefined ? `min="${options.min}"` : ''}></label>`;
  }

  function selectOptions(rows, valueKey, labelKey, firstLabel = null) {
    return `${firstLabel ? `<option value="">${esc(firstLabel)}</option>` : ''}${rows.map((r) => `<option value="${esc(r[valueKey])}">${esc(r[labelKey])}</option>`).join('')}`;
  }

  function emptyPanel(panel, message = 'No records are available yet.') {
    if (!panel) return;
    $$('.empty', panel).forEach((el) => el.remove());
    const existing = $('.cc-live-list', panel); if (existing) existing.remove();
    const p = document.createElement('p'); p.className = 'cc-empty-note'; p.textContent = message; panel.appendChild(p);
  }

  function liveContainer(panel, className = 'cc-live-list') {
    if (!panel) return null;
    $$('.empty', panel).forEach((el) => el.remove());
    let box = $(`.${className}`, panel);
    if (!box) { box = document.createElement('div'); box.className = className; panel.appendChild(box); }
    box.innerHTML = '';
    return box;
  }

  function findPrimaryPanel() {
    const main = $('main.main');
    if (!main) return null;
    return $('section.panel', main);
  }

  function updateStats(values) {
    const stats = $$('.stats .stat');
    stats.forEach((stat) => {
      const label = $('small', stat)?.textContent.trim().toLowerCase();
      const key = Object.keys(values).find((k) => k.toLowerCase() === label);
      if (key !== undefined) $('strong', stat).textContent = values[key] ?? '0';
    });
  }

  function resourceAction(resource, label = 'Visit resource', className = 'btn primary') {
    const source = String(resource.file_url || '');
    if (source.startsWith('/uploads/')) {
      // Uploaded files are fetched with the saved Bearer token. A successful
      // open is recorded as a resource visit before the module can be completed.
      return `<button type="button" class="${className}" data-open-resource="${esc(resource.id)}" data-module-id="${esc(resource.module_id || '')}">${esc(label)}</button>`;
    }
    if (user?.role === 'trainee' && resource.module_id) {
      // Module-linked external resources are opened only after the authenticated visit is recorded.
      return `<button type="button" class="${className}" data-visit-resource="${esc(resource.id)}" data-module-id="${esc(resource.module_id)}" data-resource-url="${esc(source)}">${esc(label)}</button>`;
    }
    return `<a class="${className}" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  }

  function cardMarkup({ icon = '📚', title, subtitle = '', meta = '', actions = '' }) {
    return `<article class="card cc-record-card course-card trainer-course-card"><div class="cc-record-top"><span class="icon">${icon}</span>${meta ? `<span class="cc-meta">${esc(meta)}</span>` : ''}</div>
      <h3>${esc(title)}</h3><p>${esc(subtitle)}</p>${actions ? `<div class="cc-record-actions">${actions}</div>` : ''}</article>`;
  }

  function renderTable(panel, headers, rows, className = 'cc-data-table') {
    const box = liveContainer(panel, 'cc-table-wrap');
    if (!box) return;
    if (!rows.length) { box.innerHTML = '<p class="cc-empty-note">No records found.</p>'; return; }
    box.innerHTML = `<table class="${className}"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  async function loadCourses() { return (await api().get('/courses')).courses || []; }
  async function loadUsers(role) { return (await api().get(`/users${api().qs({ role })}`)).users || []; }

  function courseCard(course, mode = 'trainee') {
    let actions = '';
    if (mode === 'trainee') {
      actions = course.is_enrolled
        ? `<a class="btn primary" href="course-learning.html?courseId=${course.id}">Continue Learning</a><a class="btn" href="course-details.html?id=${course.id}">Details</a>`
        : `<button class="btn primary" data-enroll="${course.id}">Enroll</button><a class="btn" href="course-details.html?id=${course.id}">View</a>`;
    } else if (mode === 'admin') {
      actions = `<select class="cc-status-select" data-course-status="${course.id}"><option value="draft" ${course.status === 'draft' ? 'selected' : ''}>Draft</option><option value="published" ${course.status === 'published' ? 'selected' : ''}>Published</option><option value="archived" ${course.status === 'archived' ? 'selected' : ''}>Archived</option></select><a class="btn" href="course-details.html?id=${course.id}">View</a>`;
    } else {
      actions = `<a class="btn" href="course-details.html?id=${course.id}">View</a><a class="btn primary" href="create-course.html?id=${course.id}">Edit</a>`;
    }
    return cardMarkup({ title: course.title, subtitle: `${course.description || ''}${course.category ? ` · ${course.category}` : ''}`, meta: `${course.status || ''}${course.learner_count !== undefined ? ` · ${course.learner_count} learners` : ''}`, actions });
  }

  async function renderCourseList(mode) {
    const panel = mode === 'explore' ? $$('.panel')[1] || findPrimaryPanel() : findPrimaryPanel();
    if (!panel) return;
    try {
      let courses;
      if (mode === 'my') courses = (await api().get('/courses/my-enrollments')).enrollments || [];
      else courses = await loadCourses();
      if (mode === 'trainer') updateStats({ 'Total Courses': courses.length, Published: courses.filter(c => c.status === 'published').length, Drafts: courses.filter(c => c.status === 'draft').length, Learners: courses.reduce((sum, c) => sum + Number(c.learner_count || 0), 0) });
      const box = liveContainer(panel, 'cc-course-grid');
      if (!courses.length) { box.innerHTML = '<p class="cc-empty-note">No courses found. Courses created and published by trainers will appear here.</p>'; return; }
      box.innerHTML = `<div class="grid3">${courses.map((c) => mode === 'my'
        ? cardMarkup({ title: c.title, subtitle: `${c.category || 'Training'} · ${c.completed_modules || 0}/${c.total_modules || 0} modules completed`, meta: 'Enrolled', actions: `<a class="btn primary" href="course-learning.html?courseId=${c.course_id}">Continue Learning</a>` })
        : courseCard(c, mode === 'explore' ? 'trainee' : mode)).join('')}</div>`;
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderDashboard() {
    try {
      const data = await api().get('/dashboard'); const s = data.summary || {};
      if (data.role === 'trainee') {
        updateStats({ 'Enrolled Courses': s.enrolledCourses, 'Assessments': s.assignedAssessments, 'Completed Modules': s.completedModules, 'Completed Courses': s.completedCourses ?? 0, 'Overall Progress': s.overallProgress === null || s.overallProgress === undefined ? '—' : `${s.overallProgress}%` });
        const panel = findPrimaryPanel();
        if (panel) {
          const box = liveContainer(panel, 'cc-dashboard-content');
          box.innerHTML = `<div class="grid3">${cardMarkup({ title: 'Enrolled Courses', subtitle: 'Courses assigned to your account', meta: s.enrolledCourses })}${cardMarkup({ title: 'Assessments Submitted', subtitle: 'Submissions awaiting or completed review', meta: s.submittedAssessments })}${cardMarkup({ title: 'Modules Completed', subtitle: 'Learning modules marked complete', meta: s.completedModules })}</div>`;
        }
      } else if (data.role === 'trainer') {
        updateStats({ Courses: s.coursesCreated, Learners: s.enrolledTrainees, Assessments: s.assessments, 'Completion Rate': `${Number(s.completionRate || 0).toFixed(0)}%` });
        const panel = findPrimaryPanel();
        if (panel) {
          const box = liveContainer(panel, 'cc-dashboard-content');
          box.innerHTML = `<div class="grid3">${cardMarkup({ title: 'Courses Created', subtitle: 'Training courses owned by you', meta: s.coursesCreated })}${cardMarkup({ title: 'Enrolled Learners', subtitle: 'Trainees enrolled in your courses', meta: s.enrolledTrainees })}${cardMarkup({ title: 'Pending Reviews', subtitle: 'Assessment submissions awaiting grading', meta: s.pendingReviews })}${cardMarkup({ title: 'Completion Rate', subtitle: 'Average module completion across enrolled learners', meta: `${Number(s.completionRate || 0).toFixed(0)}%` })}</div>`;
        }
      } else {
        updateStats({ Users: s.totalUsers, Courses: s.totalCourses, Programs: s.totalPrograms, Reports: s.totalAssessments });
        const panel = findPrimaryPanel();
        if (panel) {
          const box = liveContainer(panel, 'cc-dashboard-content');
          box.innerHTML = `<div class="grid4">${cardMarkup({ title: 'Users', subtitle: 'Registered platform accounts', meta: s.totalUsers })}${cardMarkup({ title: 'Courses', subtitle: 'Training courses in the platform', meta: s.totalCourses })}${cardMarkup({ title: 'Programs', subtitle: 'Structured training programs', meta: s.totalPrograms })}${cardMarkup({ title: 'Resources', subtitle: 'Learning materials registered', meta: s.totalResources })}</div>`;
        }
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderUsers(role = null) {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = await loadUsers(role);
      const stats = { Users: rows.length, Trainees: rows.filter((x) => x.role === 'trainee').length, Trainers: rows.filter((x) => x.role === 'trainer').length, Administrators: rows.filter((x) => x.role === 'administrator').length };
      updateStats(stats);
      renderTable(panel, ['Name', 'Email', 'Role', 'Status', 'Action'], rows.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.is_active ? 'Active' : 'Inactive'}</td><td><button class="btn small" data-toggle-user="${u.id}" data-active="${u.is_active ? 0 : 1}">${u.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`));
    } catch (error) { toast(error.message, 'error'); }
  }

  function openUserModal(defaultRole = null) {
    const roleField = defaultRole ? `<input type="hidden" name="role" value="${esc(defaultRole)}">` : field('Role', 'role', 'select', { options: VALID_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })) });
    showModal(defaultRole === 'trainer' ? 'Create trainer account' : defaultRole === 'trainee' ? 'Create trainee account' : 'Create user account', `${field('Full name', 'name', 'text', { required: true })}${field('Email address', 'email', 'email', { required: true })}${field('Temporary password', 'password', 'password', { required: true, placeholder: 'At least 8 characters' })}${roleField}`,
      async (fd) => {
        const payload = { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') };
        if (user.role === 'trainer') return api().post('/trainer/trainees', payload);
        payload.role = defaultRole || fd.get('role');
        return api().post('/users', payload);
      });
  }

  const VALID_ROLES = ['trainee', 'trainer', 'administrator'];

  async function openCourseModal(course = null) {
    const coursesDefaults = course || {};
    showModal(course ? 'Update course' : 'Create course',
      `${field('Course title', 'title', 'text', { required: true, value: coursesDefaults.title || '' })}
       ${field('Category', 'category', 'select', { options: ['Technical Skills', 'Professional Development', 'Leadership & Management', 'Digital Skills'].map((x) => ({ value: x, label: x })) })}
       ${field('Description', 'description', 'textarea', { required: true, value: coursesDefaults.description || '' })}
       ${field('Difficulty', 'difficulty', 'select', { options: ['Beginner', 'Intermediate', 'Advanced'].map((x) => ({ value: x, label: x })) })}
       ${field('Duration', 'duration', 'text', { placeholder: 'Example: 4 weeks', value: coursesDefaults.duration || '' })}
       ${field('Maximum learners', 'max_learners', 'number', { min: 1, value: coursesDefaults.max_learners || '' })}
       ${field('Visibility', 'status', 'select', { options: ['draft', 'published'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) })) })}
       ${field('Learning objectives (one per line)', 'objectives', 'textarea', { value: coursesDefaults.objectives || '' })}
       ${field('Module outline (one module per line)', 'modules', 'textarea', { placeholder: 'Introduction\nCore concepts\nPractical activity' })}`,
      async (fd) => {
        const body = { title: fd.get('title'), category: fd.get('category'), description: fd.get('description'), difficulty: fd.get('difficulty'), duration: fd.get('duration'), max_learners: fd.get('max_learners') || null, status: fd.get('status'), objectives: fd.get('objectives') };
        let courseId;
        if (course) { await api().patch(`/courses/${course.id}`, body); courseId = course.id; }
        else { const result = await api().post('/courses', body); courseId = result.courseId; }
        const moduleLines = String(fd.get('modules') || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (moduleLines.length) {
          for (let i = 0; i < moduleLines.length; i++) await api().post('/modules', { course_id: courseId, title: moduleLines[i], sort_order: i + 1 });
        }
      });
  }

  async function renderResources() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/resources')).resources || [];
      const box = liveContainer(panel, 'cc-resource-grid');
      updateStats({ Resources: rows.length, Documents: rows.filter((r) => r.resource_type === 'document').length, Videos: rows.filter((r) => r.resource_type === 'video').length, Links: rows.filter((r) => r.resource_type === 'link').length });
      box.innerHTML = rows.length ? `<div class="grid3">${rows.map((r) => cardMarkup({ icon: r.resource_type === 'video' ? '🎥' : r.resource_type === 'document' ? '📄' : '🔗', title: r.title, subtitle: `${r.course_title}${r.module_title ? ` · ${r.module_title}` : ''} · ${r.description || ''}`, meta: r.resource_type, actions: `${resourceAction(r, 'Open resource', 'btn primary')}${user?.role !== 'trainee' ? `<button class="btn" data-delete-resource="${r.id}">Delete</button>` : ''}` })).join('')}</div>` : '<p class="cc-empty-note">No resources have been added yet.</p>';
    } catch (error) { toast(error.message, 'error'); }
  }

  async function openResourceModal() {
    const courses = await loadCourses();
    if (!courses.length) { toast('Create a course before adding a learning resource.', 'warning'); return; }

    const initialCourseId = String(courses[0].id);
    const loadModules = async (courseId) => (await api().get(`/modules?courseId=${encodeURIComponent(courseId)}`)).modules || [];
    const initialModules = await loadModules(initialCourseId);
    if (!initialModules.length) {
      toast('Add at least one module to the course before adding a learning resource.', 'warning');
      return;
    }

    const overlay = showModal('Add learning resource',
      `${field('Course', 'course_id', 'select', { required: true, value: initialCourseId, options: courses.map((c) => ({ value: c.id, label: c.title })) })}
       ${field('Module', 'module_id', 'select', { required: true, options: initialModules.map((m) => ({ value: m.id, label: m.title })) })}
       <p class="cc-field-hint">The resource will belong to this module. Trainees must visit every resource in the module before they can mark that module complete.</p>
       ${field('Resource title', 'title', 'text', { required: true })}
       ${field('Description', 'description', 'textarea')}
       <label class="cc-field">Upload a file (optional)<input name="file" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.mp4,.webm"></label>
       ${field('Or use a resource URL', 'file_url', 'url', { placeholder: 'https://...' })}
       ${field('Resource type', 'resource_type', 'select', { options: ['document', 'video', 'link', 'other'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) })) })}`,
      async (fd) => {
        if (!fd.get('module_id')) throw new Error('Choose the module this resource belongs to.');
        const file = fd.get('file');
        if (file && file.size > 0) return api().upload('/resources/upload', fd);
        return api().post('/resources', {
          course_id: fd.get('course_id'),
          module_id: fd.get('module_id'),
          title: fd.get('title'),
          description: fd.get('description'),
          file_url: fd.get('file_url'),
          resource_type: fd.get('resource_type')
        });
      });

    const courseSelect = $('select[name="course_id"]', overlay);
    const moduleSelect = $('select[name="module_id"]', overlay);
    if (courseSelect && moduleSelect) {
      courseSelect.addEventListener('change', async () => {
        moduleSelect.disabled = true;
        moduleSelect.innerHTML = '<option value="">Loading modules…</option>';
        try {
          const modules = await loadModules(courseSelect.value);
          moduleSelect.innerHTML = modules.length
            ? modules.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')
            : '<option value="">No modules available — add modules to this course first</option>';
          moduleSelect.disabled = !modules.length;
        } catch (error) {
          moduleSelect.innerHTML = '<option value="">Unable to load modules</option>';
          toast(error.message, 'error');
        }
      });
    }
  }

  async function renderCompetencies() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/competencies')).competencies || [];
      updateStats({ Competencies: rows.length, 'Competencies Tracked': rows.length, Developed: 0, 'Skill Gaps': 0 });
      const box = liveContainer(panel, 'cc-competency-grid');
      box.innerHTML = rows.length ? `<div class="grid3">${rows.map((c) => cardMarkup({ icon: '🎯', title: c.name, subtitle: c.description || 'Competency definition', meta: c.category || 'General' })).join('')}</div>` : '<p class="cc-empty-note">No competency definitions have been added yet.</p>';
      if (user?.role !== 'trainee') await appendCompetencyMapping(panel, rows);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function appendCompetencyMapping(panel, competencies) {
    if (!competencies.length) return;
    const courses = await loadCourses();
    const wrap = document.createElement('section'); wrap.className = 'panel cc-mapping-panel';
    wrap.innerHTML = `<div class="panel-head"><div><h2>Map competencies to a course</h2><p>Select the competencies that a course is intended to develop.</p></div></div>
      <form id="ccMappingForm" class="cc-inline-form"><label>Course<select name="course_id" required>${selectOptions(courses, 'id', 'title', 'Select course')}</select></label>
      <label>Competencies<select name="competencyIds" multiple size="5">${selectOptions(competencies, 'id', 'name')}</select></label>
      <button class="btn primary">Save mapping</button></form>`;
    panel.parentNode.insertBefore(wrap, panel.nextSibling);
    $('#ccMappingForm', wrap).addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const ids = Array.from($('select[name="competencyIds"]', e.currentTarget).selectedOptions).map((o) => Number(o.value));
      try { await api().put(`/competencies/course/${fd.get('course_id')}`, { competencyIds: ids }); toast('Competency mapping saved.'); }
      catch (error) { toast(error.message, 'error'); }
    });
  }

  async function openCompetencyModal() {
    showModal('Add competency', `${field('Competency name', 'name', 'text', { required: true })}${field('Category', 'category', 'text', { placeholder: 'Technical Skills, Professional Skills...' })}${field('Description', 'description', 'textarea')}`,
      async (fd) => api().post('/competencies', { name: fd.get('name'), category: fd.get('category'), description: fd.get('description') }));
  }

  async function renderAssessments() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const data = await api().get('/assessments');
      const rows = data.assessments || [];
      const box = liveContainer(panel, 'cc-assessment-list');
      let submissions = [];
      if (user.role === 'trainee') {
        submissions = (await api().get('/assessments/submissions')).submissions || [];
      }
      const submissionByAssessment = new Map(submissions.map((s) => [Number(s.assessment_id), s]));
      const reviewed = submissions.filter((s) => s.marks_obtained !== null && s.marks_obtained !== undefined);
      const averageScore = reviewed.length
        ? (reviewed.reduce((sum, s) => sum + Number(s.marks_obtained || 0), 0) / reviewed.length).toFixed(1)
        : '—';
      updateStats({ Assessments: rows.length, Published: rows.length, Attempts: submissions.length, 'Average Score': averageScore });

      box.innerHTML = rows.length ? `<div class="cc-list">${rows.map((a) => {
        let action = '';
        if (user.role === 'trainee') {
          const submission = submissionByAssessment.get(Number(a.id));
          if (!submission) {
            action = `<button class="btn primary" data-submit-assessment="${a.id}">Start assessment</button>`;
          } else {
            const isReviewed = submission.marks_obtained !== null && submission.marks_obtained !== undefined;
            const state = isReviewed
              ? `Reviewed · ${esc(submission.marks_obtained)} / ${esc(a.total_marks)} marks`
              : 'Submitted · Awaiting trainer review';
            const check = parseJsonValue(submission.auto_check_json, null);
            const checkText = check?.checked
              ? ` · Auto-check ${Number(check.correctCount || 0)}/${Number(check.totalQuestions || 0)} correct`
              : ' · Trainer review required';
            action = `<div class="cc-assessment-trainee-status"><span class="cc-meta cc-assessment-state">${state}${checkText}</span><button class="btn" data-view-assessment-result="${a.id}">View answer check</button></div>`;
          }
        } else {
          const hasKey = Array.isArray(parseJsonValue(a.answer_key_json, null));
          const isMcq = parseJsonValue(a.questions_json, []).some((q) => q && typeof q === 'object' && Array.isArray(q.options));
          action = `<div class="cc-assessment-trainer-actions"><span class="cc-meta">${isMcq ? 'MCQ quiz · auto-graded' : (hasKey ? 'Answer key configured' : 'Written assessment')}</span>${isMcq ? '' : `<button class="btn" data-set-answer-key="${a.id}">${hasKey ? 'Edit answer key' : 'Set answer key'}</button>`}<button class="btn danger" data-delete-assessment="${a.id}">Delete assignment</button></div>`;
        }
        return `<article class="cc-list-item"><div><strong>${esc(a.title)}</strong><span>${esc(a.course_title)} · ${esc(a.total_marks)} marks</span><p>${esc(a.instructions || '')}</p></div><div class="cc-list-actions">${action}</div></article>`;
      }).join('')}</div>` : '<p class="cc-empty-note">No assessments are available for this account yet.</p>';
      if (user.role !== 'trainee') await renderSubmissions(panel);
    } catch (error) { toast(error.message, 'error'); }
  }

  function parseJsonValue(value, fallback = null) {
    if (Array.isArray(value) || (value && typeof value === 'object')) return value;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return fallback; } }
    return fallback;
  }

  function normalizeAssessmentQuestions(raw) {
    const parsed = parseJsonValue(raw, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map((item) => typeof item === 'string' ? item.trim() : item).filter((item) => typeof item === 'string' ? item.length : String(item.question || '').trim().length);
  }

  function normalizeResponses(raw) {
    const parsed = parseJsonValue(raw, raw);
    if (Array.isArray(parsed?.responses)) return parsed.responses.map((item, index) => ({
      question: item.question || `Question ${index + 1}`, answer: item.answer || ''
    }));
    if (Array.isArray(parsed)) return parsed.map((item, index) => ({
      question: item.question || `Question ${index + 1}`, answer: item.answer || item.response || ''
    }));
    if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([key, value]) => ({
      question: key === 'response' ? 'Assessment response' : key,
      answer: typeof value === 'string' ? value : JSON.stringify(value)
    }));
    return [{ question: 'Assessment response', answer: String(parsed || '') }];
  }

  function formatSubmissionAnswers(rawAnswers, rawCheck) {
    const responses = normalizeResponses(rawAnswers);
    const check = parseJsonValue(rawCheck, null);
    if (!responses.length) return '<p class="cc-empty-note">No answers were provided.</p>';
    return `<div class="cc-answer-review">${responses.map((entry, index) => {
      const result = check?.results?.[index];
      let badge = '<span class="cc-answer-badge pending">Trainer review required</span>';
      if (result?.status === 'correct') badge = `<span class="cc-answer-badge correct">Correct · ${result.matchedKeywords}/${result.totalKeywords} key points</span>`;
      else if (result?.status === 'incorrect') badge = `<span class="cc-answer-badge incorrect">Incorrect · ${result.matchedKeywords}/${result.totalKeywords} key points</span>`;
      return `<div class="cc-answer-item"><strong>${esc(entry.question || `Question ${index + 1}`)}</strong>${badge}<p>${esc(entry.answer || 'No answer provided')}</p></div>`;
    }).join('')}</div>`;
  }

  async function renderSubmissions(panel) {
    const rows = (await api().get('/assessments/submissions')).submissions || [];
    const oldPanel = $('.cc-submissions-panel', panel.parentNode);
    if (oldPanel) oldPanel.remove();
    const wrap = document.createElement('section'); wrap.className = 'panel cc-submissions-panel';
    wrap.innerHTML = `<div class="panel-head"><div><h2>Submitted assessments</h2><p>Automatic keyword checks are provisional. Review descriptive answers and enter final marks and feedback.</p></div></div><div class="cc-submissions-content"></div>`;
    const content = $('.cc-submissions-content', wrap);
    if (!rows.length) content.innerHTML = '<p class="cc-empty-note">No submissions received yet.</p>';
    else content.innerHTML = `<div class="cc-list">${rows.map((s) => `<article class="cc-list-item cc-submission-review"><div><strong>${esc(s.assessment_title)} · ${esc(s.trainee_name)}</strong><span>${esc(s.course_title)} · Submitted ${new Date(s.submitted_at).toLocaleString()}</span>${formatSubmissionAnswers(s.answers_json, s.auto_check_json)}<p class="cc-submission-result">${s.marks_obtained === null ? 'Not reviewed' : `${esc(s.marks_obtained)} / ${esc(s.total_marks)} · ${esc(s.feedback || '')}`}</p></div><div class="cc-list-actions">${s.marks_obtained === null ? `<button class="btn primary" data-grade-submission="${s.id}" data-total="${s.total_marks}">Grade</button>` : '<span class="cc-meta">Reviewed</span>'}</div></article>`).join('')}</div>`;
    panel.parentNode.insertBefore(wrap, panel.nextSibling);
  }

  async function openAnswerKeyModal(assessmentId) {
    const data = await api().get('/assessments');
    const assessment = (data.assessments || []).find((item) => Number(item.id) === Number(assessmentId));
    if (!assessment) throw new Error('Assessment not found. Refresh and try again.');
    const questions = normalizeAssessmentQuestions(assessment.questions_json);
    if (!questions.length) throw new Error('This assessment has no questions to configure.');
    const savedKeys = parseJsonValue(assessment.answer_key_json, []);
    const lines = questions.map((_, index) => Array.isArray(savedKeys?.[index]) ? savedKeys[index].join(', ') : '').join('\n');
    const questionList = questions.map((question, index) => `<p><strong>Q${index + 1}.</strong> ${esc(question)}</p>`).join('');
    showModal('Set automatic answer keywords', `${field('Accepted keywords (one line per question; separate keywords with commas)', 'answer_keys', 'textarea', { required: true, value: lines, placeholder: 'communication, information, ideas, coordination\nspoken words, gestures, body language' })}<div class="cc-answer-key-help"><strong>Questions in this assessment</strong>${questionList}<small>Use important words or short phrases that should appear in a correct answer. Automatic checking is a guide; the trainer confirms final marks.</small></div>`,
      async (fd) => {
        const answerKeys = String(fd.get('answer_keys') || '').split(/\r?\n/).map((line) => line.split(',').map((word) => word.trim()).filter(Boolean)).filter((line) => line.length);
        if (answerKeys.length !== questions.length || answerKeys.some((line) => !line.length)) {
          throw new Error(`Enter exactly ${questions.length} non-empty lines, one for each question.`);
        }
        await api().patch(`/assessments/${assessmentId}/answer-key`, { answerKeys });
        toast('Answer-check keywords saved.');
        await renderAssessments();
      }, 'Save answer key');
  }

  async function openAssessmentResultModal(assessmentId) {
    const rows = (await api().get('/assessments/submissions')).submissions || [];
    const submission = rows.find((item) => Number(item.assessment_id) === Number(assessmentId));
    if (!submission) throw new Error('No saved submission was found for this assessment.');
    const answers = normalizeResponses(submission.answers_json);
    const check = parseJsonValue(submission.auto_check_json, null);
    const resultsHtml = answers.map((entry, index) => {
      const result = check?.results?.[index];
      const label = result?.status === 'correct' ? 'Correct' : result?.status === 'incorrect' ? 'Incorrect' : 'Trainer review required';
      const style = result?.status || 'pending';
      const score = result && result.totalKeywords ? `${result.matchedKeywords}/${result.totalKeywords} key points matched` : 'No automatic answer key configured';
      return `<article class="cc-result-question"><strong>Question ${index + 1}: ${esc(entry.question)}</strong><span class="cc-answer-badge ${style}">${label}</span><p>${esc(entry.answer || 'No answer provided')}</p><small>${score}</small></article>`;
    }).join('');
    const overlay = document.createElement('div'); overlay.className = 'cc-modal-backdrop';
    const finalReview = submission.marks_obtained !== null && submission.marks_obtained !== undefined
      ? `<div class="cc-answer-key-help"><strong>Trainer's final result:</strong> ${esc(submission.marks_obtained)} / ${esc(submission.total_marks)} marks<br/><strong>Feedback:</strong> ${esc(submission.feedback || 'No additional feedback provided.')}</div>`
      : `<div class="cc-answer-key-help"><strong>Trainer's final result:</strong> Awaiting review and grading.</div>`;
    overlay.innerHTML = `<section class="cc-modal cc-result-modal" role="dialog" aria-modal="true"><div class="cc-modal-head"><div><h2>Answer check – ${esc(submission.assessment_title)}</h2><p>${esc(submission.course_title)} · ${check?.checked ? `${check.correctCount}/${check.totalQuestions} answers marked correct` : 'Awaiting trainer review'}</p></div><button type="button" class="cc-close" aria-label="Close">×</button></div><div class="cc-result-list">${resultsHtml}</div>${finalReview}<p class="cc-answer-key-help">Automatic keyword matching is provisional for written answers. Your trainer's reviewed marks and feedback are the final result.</p><div class="cc-modal-actions"><button type="button" class="btn primary" data-result-close>Close</button></div></section>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    $('.cc-close', overlay).addEventListener('click', close);
    $('[data-result-close]', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }

  async function openAssessmentModal() {
    const courses = await loadCourses();
    if (!courses.length) { toast('Create a course before creating an assessment.', 'warning'); return; }
    const overlay = showModal('Create assessment', `${field('Course', 'course_id', 'select', { required: true, options: courses.map((c) => ({ value: c.id, label: c.title })) })}${field('Assessment title', 'title', 'text', { required: true })}${field('Assessment format', 'format', 'select', { required: true, options: [{ value: 'quiz', label: 'Quiz – Multiple choice (MCQ)' }, { value: 'written', label: 'Written assessment' }] })}${field('Instructions', 'instructions', 'textarea')}${field('Total marks', 'total_marks', 'number', { required: true, min: 1, value: 30 })}${field('Due date', 'due_date', 'datetime-local')}${field('Questions', 'questions', 'textarea', { required: true, placeholder: 'For MCQ, enter one question per line using this format:\nQuestion|Option A|Option B|Option C|Option D|Correct option (A/B/C/D)\n\nExample:\nWhat does HTML stand for?|Hyper Text Markup Language|High Text Machine Language|Home Tool Markup Language|Hyperlinks Text Mode Language|A\n\nFor written format, enter one question per line.' })}`,
      async (fd) => {
        const lines = String(fd.get('questions') || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (!lines.length) throw new Error('Add at least one question.');
        let questions;
        if (fd.get('format') === 'quiz') {
          questions = lines.map((line, index) => {
            const parts = line.split('|').map((part) => part.trim());
            if (parts.length !== 6) throw new Error(`Question ${index + 1}: enter the question, four options and correct option separated by |.`);
            const correctAnswer = parts[5].toUpperCase();
            if (!['A', 'B', 'C', 'D'].includes(correctAnswer) || parts.slice(0, 5).some((part) => !part)) throw new Error(`Question ${index + 1}: provide all fields and use A, B, C or D as the correct option.`);
            return { question: parts[0], options: parts.slice(1, 5).map((label, optionIndex) => ({ value: ['A','B','C','D'][optionIndex], label })), correctAnswer };
          });
        } else questions = lines;
        await api().post('/assessments', { course_id: fd.get('course_id'), title: fd.get('title'), instructions: fd.get('instructions'), total_marks: Number(fd.get('total_marks')), due_date: fd.get('due_date') || null, questions });
        await renderAssessments();
      });
    const formatSelect = $('select[name="format"]', overlay);
    const questionField = $('textarea[name="questions"]', overlay);
    formatSelect.addEventListener('change', () => {
      questionField.placeholder = formatSelect.value === 'quiz'
        ? 'Question|Option A|Option B|Option C|Option D|Correct option (A/B/C/D)\nWhat does HTML stand for?|Hyper Text Markup Language|High Text Machine Language|Home Tool Markup Language|Hyperlinks Text Mode Language|A'
        : 'Enter one written question per line.';
    });
  }

  async function openSubmissionModal(id) {
    const data = await api().get('/assessments');
    const assessment = (data.assessments || []).find((item) => Number(item.id) === Number(id));
    if (!assessment) throw new Error('Assessment could not be found. Refresh the page and try again.');
    const questions = normalizeAssessmentQuestions(assessment.questions_json);
    if (!questions.length) { toast('This assessment does not contain individual questions yet. Please contact the trainer.', 'warning'); return; }

    const answers = questions.map(() => '');
    let currentIndex = 0;
    const overlay = document.createElement('div'); overlay.className = 'cc-modal-backdrop';
    overlay.innerHTML = `<section class="cc-modal cc-quiz-modal" role="dialog" aria-modal="true" aria-labelledby="ccQuizTitle">
      <div class="cc-modal-head"><div><h2 id="ccQuizTitle">${esc(assessment.title)}</h2><p class="cc-quiz-course">${esc(assessment.course_title || 'Workplace assessment')} · ${esc(assessment.total_marks)} marks</p></div><button type="button" class="cc-close" aria-label="Close assessment">×</button></div>
      <div class="cc-quiz-instructions">${esc(assessment.instructions || 'Answer each question in your own words. Use Next to move forward. You can return to previous questions before submitting.')}</div>
      <div class="cc-quiz-progress"><div class="cc-quiz-progress-label"><strong class="cc-quiz-step"></strong><span class="cc-quiz-percent"></span></div><div class="cc-quiz-progress-track"><span class="cc-quiz-progress-fill"></span></div></div>
      <div class="cc-quiz-question"><span class="cc-quiz-kicker"></span><h3 class="cc-quiz-question-text"></h3><label class="cc-field">Your answer<textarea class="cc-quiz-answer" rows="7" placeholder="Type your answer here..." required></textarea></label><p class="cc-quiz-hint">Your answer is saved as you move between questions. You can use Previous to review it.</p></div>
      <div class="cc-modal-message cc-quiz-message" aria-live="polite"></div>
      <div class="cc-quiz-actions"><button type="button" class="btn cc-quiz-previous">Previous</button><span class="cc-quiz-spacer"></span><button type="button" class="btn primary cc-quiz-next">Next question</button></div>
    </section>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    $('.cc-close', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    const answerInput = $('.cc-quiz-answer', overlay);
    const previousButton = $('.cc-quiz-previous', overlay);
    const nextButton = $('.cc-quiz-next', overlay);
    const message = $('.cc-quiz-message', overlay);
    function saveCurrentAnswer() { const choice = $('input[name="ccQuizChoice"]:checked', overlay); answers[currentIndex] = choice ? choice.value : answerInput.value.trim(); }
    function renderQuestion() {
      $('.cc-quiz-step', overlay).textContent = `Question ${currentIndex + 1} of ${questions.length}`;
      $('.cc-quiz-percent', overlay).textContent = `${Math.round(((currentIndex + 1) / questions.length) * 100)}%`;
      $('.cc-quiz-progress-fill', overlay).style.width = `${((currentIndex + 1) / questions.length) * 100}%`;
      $('.cc-quiz-kicker', overlay).textContent = `QUESTION ${currentIndex + 1}`;
      const currentQuestion = questions[currentIndex];
      $('.cc-quiz-question-text', overlay).textContent = typeof currentQuestion === 'string' ? currentQuestion : currentQuestion.question;
      const questionBox = $('.cc-quiz-question', overlay);
      const existingOptions = $('.cc-quiz-options', questionBox); if (existingOptions) existingOptions.remove();
      const isMcq = currentQuestion && typeof currentQuestion === 'object' && Array.isArray(currentQuestion.options);
      answerInput.style.display = isMcq ? 'none' : '';
      if (isMcq) { const options = document.createElement('div'); options.className = 'cc-quiz-options'; options.innerHTML = currentQuestion.options.map((option) => `<label class="cc-quiz-option"><input type="radio" name="ccQuizChoice" value="${esc(option.value)}" ${answers[currentIndex] === option.value ? 'checked' : ''}> <span><strong>${esc(option.value)}.</strong> ${esc(option.label)}</span></label>`).join(''); questionBox.insertBefore(options, answerInput.parentElement); }
      answerInput.value = answers[currentIndex];
      previousButton.disabled = currentIndex === 0;
      nextButton.textContent = currentIndex === questions.length - 1 ? 'Submit assessment' : 'Next question';
      message.innerHTML = ''; answerInput.focus();
    }
    previousButton.addEventListener('click', () => { saveCurrentAnswer(); if (currentIndex > 0) { currentIndex -= 1; renderQuestion(); } });
    nextButton.addEventListener('click', async () => {
      saveCurrentAnswer();
      if (!answers[currentIndex]) { message.innerHTML = '<div class="notice warning">Please enter an answer before moving to the next question.</div>'; answerInput.focus(); return; }
      if (currentIndex < questions.length - 1) { currentIndex += 1; renderQuestion(); return; }
      const missingIndex = answers.findIndex((answer) => !answer);
      if (missingIndex !== -1) { currentIndex = missingIndex; renderQuestion(); message.innerHTML = '<div class="notice warning">Please answer every question before submitting.</div>'; return; }
      nextButton.disabled = true; previousButton.disabled = true; nextButton.textContent = 'Submitting…'; message.innerHTML = '';
      const responsePayload = { responses: questions.map((question, index) => ({ question: typeof question === 'string' ? question : question.question, answer: answers[index] })) };
      try {
        const submission = await api().post(`/assessments/${id}/submit`, { answers: responsePayload });
        close();
        const check = submission.autoCheck;
        if (check?.checked) toast(`Assessment submitted. Automatic check: ${check.correctCount}/${check.totalQuestions} answers matched the answer key. Trainer will confirm final marks.`);
        else toast('Assessment submitted. Your trainer will review your answers.');
        await renderAssessments();
      } catch (error) {
        message.innerHTML = `<div class="notice warning">${esc(error.message)}</div>`;
        nextButton.disabled = false; previousButton.disabled = false; nextButton.textContent = 'Submit assessment';
      }
    });
    renderQuestion();
  }

  function openGradeModal(id, total) {
    showModal('Review assessment', `${field('Marks (out of ' + total + ')', 'marks_obtained', 'number', { required: true, min: 0 })}${field('Feedback', 'feedback', 'textarea')}`,
      async (fd) => {
        await api().patch(`/assessments/submissions/${id}/grade`, {
          marks_obtained: Number(fd.get('marks_obtained')),
          feedback: fd.get('feedback')
        });
        await renderAssessments();
      });
  }

  async function renderProgress() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      if (user.role === 'trainee') {
        const data = await api().get('/progress/my'); const rows = data.progress || [];
        const totalModules = rows.reduce((sum, r) => sum + Number(r.total_modules || 0), 0);
        const doneModules = rows.reduce((sum, r) => sum + Number(r.completed_modules || 0), 0);
        const summary = data.summary || {};
        const avg = summary.assessment_average;
        updateStats({ 'Completed Modules': doneModules, 'Completed Courses': summary.completed_courses ?? 0, 'Overall Progress': summary.overall_progress === null || summary.overall_progress === undefined ? (totalModules ? `${Math.round(doneModules / totalModules * 100)}%` : '—') : `${Math.round(summary.overall_progress)}%`, 'Assessment Average': avg === null || avg === undefined ? '—' : `${Number(avg).toFixed(1)}%`, 'Learning Activity': rows.length });
        const box = liveContainer(panel, 'cc-progress-list');
        box.innerHTML = rows.length ? `<div class="cc-list">${rows.map((r) => {
          const pct = r.total_modules ? Math.round(r.completed_modules / r.total_modules * 100) : 0;
          return `<article class="cc-list-item"><div><strong>${esc(r.title)}</strong><span>${r.completed_modules}/${r.total_modules} modules completed · ${r.submitted_assessments}/${r.total_assessments} assessments submitted</span><div class="cc-progress"><span style="width:${pct}%"></span></div></div><strong>${pct}%</strong></article>`;
        }).join('')}</div>` : '<p class="cc-empty-note">Enroll in a course to start building your progress record.</p>';
        const resultsPanel = $$('.panel')[1];
        if (resultsPanel) {
          const wrap = document.createElement('div'); wrap.className = 'cc-live-list';
          const results = data.assessmentResults || [];
          wrap.innerHTML = results.length ? `<div class="cc-list">${results.map((r) => `<article class="cc-list-item"><div><strong>${esc(r.assessment_title)}</strong><span>${esc(r.course_title)}</span><p>${r.marks_obtained === null ? 'Awaiting review' : `${esc(r.marks_obtained)} / ${esc(r.total_marks)} · ${esc(r.feedback || '')}`}</p></div></article>`).join('')}</div>` : '<p class="cc-empty-note">Assessment results will appear after trainer review.</p>';
          resultsPanel.appendChild(wrap);
        }
      } else {
        const rows = (await api().get('/progress/courses')).progress || [];
        renderTable(panel, ['Trainee', 'Email', 'Course', 'Submissions', 'Average marks'], rows.map((r) => `<tr><td>${esc(r.trainee_name)}</td><td>${esc(r.trainee_email)}</td><td>${esc(r.course_title)}</td><td>${esc(r.submitted_assessments)}/${esc(r.total_assessments)}</td><td>${r.average_marks === null ? '—' : Number(r.average_marks).toFixed(1)}</td></tr>`));
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderTrainees() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/progress/courses')).progress || [];
      const unique = [...new Map(rows.map((r) => [r.trainee_id, r])).values()];
      updateStats({ Trainees: unique.length, Active: unique.length, 'Average Progress': '—', 'Need Support': rows.filter((r) => Number(r.submitted_assessments) < Number(r.total_assessments)).length });
      renderTable(panel, ['Trainee', 'Email', 'Course', 'Assessments submitted', 'Average marks'], rows.map((r) => `<tr><td>${esc(r.trainee_name)}</td><td>${esc(r.trainee_email)}</td><td>${esc(r.course_title)}</td><td>${esc(r.submitted_assessments)}/${esc(r.total_assessments)}</td><td>${r.average_marks === null ? '—' : Number(r.average_marks).toFixed(1)}</td></tr>`));
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderPrograms() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/programs')).programs || [];
      const box = liveContainer(panel, 'cc-program-list');
      box.innerHTML = rows.length ? `<div class="grid3">${rows.map((p) => cardMarkup({ title: p.title, subtitle: p.description || p.goal || '', meta: `${p.status} · ${p.course_count} courses`, actions: `<button class="btn" data-program-courses="${p.id}">View courses</button>` })).join('')}</div>` : '<p class="cc-empty-note">No training programs have been created yet.</p>';
    } catch (error) { toast(error.message, 'error'); }
  }

  async function openProgramModal() {
    const courses = await loadCourses();
    if (!courses.length) { toast('Create at least one course before creating a training program.', 'warning'); return; }
    showModal('Create training program', `${field('Program title', 'title', 'text', { required: true })}${field('Description', 'description', 'textarea')}${field('Development goal', 'goal', 'textarea')}${field('Status', 'status', 'select', { options: ['draft', 'published'].map((x) => ({ value: x, label: x })) })}<label class="cc-field">Courses included<select name="course_ids" multiple size=6>${selectOptions(courses, 'id', 'title')}</select><small>Hold Ctrl (Windows) to select more than one course.</small></label>`,
      async (fd, overlay) => {
        const selected = Array.from($('select[name="course_ids"]', overlay).selectedOptions).map((option) => Number(option.value));
        return api().post('/programs', { title: fd.get('title'), description: fd.get('description'), goal: fd.get('goal'), status: fd.get('status'), course_ids: selected });
      });
  }

  async function renderNotifications() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/notifications')).notifications || [];
      const box = liveContainer(panel, 'cc-notification-list');
      box.innerHTML = rows.length ? `<div class="cc-list">${rows.map((n) => `<article class="cc-list-item"><div><strong>${esc(n.title)}</strong><span>${esc(n.category)} · ${new Date(n.created_at).toLocaleString()} · ${esc(n.created_by)}</span><p>${esc(n.message)}</p></div>${n.is_read ? '<span class="cc-meta">Read</span>' : `<button class="btn" data-read-notification="${n.id}">Mark read</button>`}</article>`).join('')}</div>` : '<p class="cc-empty-note">There are no notifications for your account.</p>';
    } catch (error) { toast(error.message, 'error'); }
  }

  function openNotificationModal() {
    showModal('Create announcement', `${field('Title', 'title', 'text', { required: true })}${field('Message', 'message', 'textarea', { required: true })}${field('Category', 'category', 'select', { options: ['Announcement', 'Training', 'Assessment', 'System'].map((x) => ({ value: x, label: x })) })}${field('Target role', 'target_role', 'select', { options: [{ value: '', label: 'All users' }, ...VALID_ROLES.map((x) => ({ value: x, label: x }))] })}`,
      async (fd) => api().post('/notifications', { title: fd.get('title'), message: fd.get('message'), category: fd.get('category'), target_role: fd.get('target_role') || null }));
  }

  async function renderFeedback() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/feedback')).feedback || [];
      const box = liveContainer(panel, 'cc-feedback-list');
      box.innerHTML = rows.length ? `<div class="cc-list">${rows.map((f) => `<article class="cc-list-item"><div><strong>${esc(f.subject || f.feedback_type)}</strong><span>${esc(f.course_title || 'General')} · ${esc(f.rating)}/5 · ${new Date(f.created_at).toLocaleDateString()}</span><p>${esc(f.comments)}</p></div></article>`).join('')}</div>` : '<p class="cc-empty-note">No feedback submitted yet.</p>';
    } catch (error) { toast(error.message, 'error'); }
  }

  async function setupFeedback() {
    const form = $('form[data-demo-form]'); if (!form) return;
    form.removeAttribute('data-demo-form');
    const selects = $$('select', form);
    if (selects[0]) {
      try { const courses = await loadCourses(); selects[0].innerHTML = `<option value="">Select a course (optional)</option>${selectOptions(courses, 'id', 'title')}`; }
      catch (_) { /* course selection stays usable as optional */ }
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const fd = new FormData(form);
      const type = selects[1]?.value || 'General'; const rating = Number(selects[2]?.value?.charAt(0));
      try {
        await api().post('/feedback', { course_id: selects[0]?.value || null, feedback_type: type, rating, subject: $('input', form)?.value || '', comments: $('textarea', form)?.value || '' });
        setMessage('feedbackMsg', 'Thank you. Your feedback has been saved.'); form.reset();
      } catch (error) { setMessage('feedbackMsg', error.message, 'warning'); }
    });
  }

  async function setupSettings() {
    const form = $('form[data-demo-form]'); if (!form) return;
    form.removeAttribute('data-demo-form');
    try {
      const profile = (await api().get('/profile/me')).profile;
      const inputs = $$('input', form); if (inputs[0]) inputs[0].value = profile.name || '';
      if (inputs[1]) inputs[1].value = profile.email || '';
      const selects = $$('select', form);
      selects.forEach((s) => {
        const label = s.closest('label')?.textContent.toLowerCase() || '';
        if (label.includes('language') && profile.language) s.value = profile.language;
        if (label.includes('notification') && profile.notification_preference) s.value = profile.notification_preference;
        if (label.includes('learning') && profile.learning_preference) s.value = profile.learning_preference;
      });
      const textarea = $('textarea', form); if (textarea && profile.professional_summary) textarea.value = profile.professional_summary;
    } catch (error) { toast(error.message, 'error'); }
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const inputs = $$('input', form), selects = $$('select', form), textarea = $('textarea', form);
      const body = { name: inputs[0]?.value, email: inputs[1]?.value };
      selects.forEach((s) => {
        const label = s.closest('label')?.textContent.toLowerCase() || '';
        if (label.includes('language')) body.language = s.value;
        if (label.includes('notification')) body.notification_preference = s.value;
        if (label.includes('learning')) body.learning_preference = s.value;
      });
      if (textarea) body.professional_summary = textarea.value;
      try { const result = await api().patch('/profile/me', body); const u = api().getUser(); api().saveSession({ token: localStorage.getItem('capacityConnectToken'), user: { ...u, ...result.user } }); setMessage(form.querySelector('.full:last-child') || form, 'Profile updated.'); }
      catch (error) { toast(error.message, 'error'); }
    });
  }

  async function setupAdminSettings() {
    const form = $('form[data-demo-form]'); if (!form) return;
    form.removeAttribute('data-demo-form');
    try {
      const settings = (await api().get('/settings')).settings;
      const inputs = $$('input', form); if (inputs[0] && settings.platform_name) inputs[0].value = settings.platform_name;
      const selects = $$('select', form); selects.forEach((s) => {
        const label = s.closest('label')?.textContent.toLowerCase() || '';
        if (label.includes('language') && settings.default_language) s.value = settings.default_language;
        if (label.includes('notification') && settings.notification_mode) s.value = settings.notification_mode;
        if (label.includes('registration') && settings.registration_mode) s.value = settings.registration_mode;
      });
      const textarea = $('textarea', form); if (textarea && settings.platform_description) textarea.value = settings.platform_description;
    } catch (error) { toast(error.message, 'error'); }
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const inputs = $$('input', form), selects = $$('select', form), textarea = $('textarea', form);
      const body = { platform_name: inputs[0]?.value, default_language: selects[0]?.value, notification_mode: selects[1]?.value, registration_mode: selects[2]?.value, platform_description: textarea?.value || '' };
      try { await api().put('/settings', body); setMessage('adminSettingsMsg', 'Platform settings saved.'); }
      catch (error) { setMessage('adminSettingsMsg', error.message, 'warning'); }
    });
  }

  async function renderCourseDetails() {
    const id = new URLSearchParams(location.search).get('id'); const panel = findPrimaryPanel();
    if (!id || !panel) return;
    try {
      const { course } = await api().get(`/courses/${id}`);
      const [modules, competencies] = await Promise.all([api().get(`/modules?courseId=${id}`).catch(() => ({ modules: [] })), api().get(`/competencies/course/${id}`).catch(() => ({ competencies: [] }))]);
      const box = liveContainer(panel, 'cc-course-details');
      const enrollmentAction = user.role === 'trainee'
        ? (course.is_enrolled ? `<a class="btn primary" href="course-learning.html?courseId=${course.id}">Continue Learning</a>` : `<button class="btn primary" data-enroll="${course.id}">Enroll in this course</button>`)
        : `<span class="cc-meta">${esc(course.status)}</span>`;
      box.innerHTML = `<h2>${esc(course.title)}</h2><p>${esc(course.description || '')}</p><p><strong>Category:</strong> ${esc(course.category || 'General')} · <strong>Difficulty:</strong> ${esc(course.difficulty || '—')} · <strong>Duration:</strong> ${esc(course.duration || '—')}</p>
       <h3>Learning objectives</h3><p>${esc(course.objectives || 'No objectives specified.')}</p><h3>Modules</h3><ul>${(modules.modules || []).map((m) => `<li>${esc(m.title)}</li>`).join('') || '<li>No modules listed.</li>'}</ul>
       <h3>Competencies</h3><p>${(competencies.competencies || []).map((c) => esc(c.name)).join(', ') || 'No competencies mapped yet.'}</p>${enrollmentAction}`;
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderCourseLearning() {
    const id = new URLSearchParams(location.search).get('courseId'); const panel = findPrimaryPanel();
    if (!id || !panel) return;
    try {
      const [courseData, moduleData, resourceData] = await Promise.all([
        api().get(`/courses/${id}`),
        api().get(`/modules?courseId=${id}`),
        api().get(`/resources?courseId=${id}`)
      ]);
      const resources = resourceData.resources || [];
      const modules = moduleData.modules || [];
      const box = liveContainer(panel, 'cc-learning-workspace');
      const moduleCards = modules.map((m) => {
        const moduleResources = resources.filter((r) => Number(r.module_id) === Number(m.id));
        const resourceCount = Number(m.resource_count ?? moduleResources.length);
        const visitedCount = Number(m.visited_resource_count ?? moduleResources.filter((r) => Number(r.visited_by_user) === 1).length);
        const allVisited = resourceCount > 0 && visitedCount >= resourceCount;
        const completed = Number(m.is_completed) === 1;
        const resourceHtml = moduleResources.length
          ? `<div class="cc-module-resources"><strong>Required learning resources</strong>${moduleResources.map((r) => `<div class="cc-module-resource"><div><span>${esc(r.title)}</span><small>${esc(r.resource_type)}${Number(r.visited_by_user) === 1 ? ' · Visited' : ' · Not visited yet'}</small></div>${resourceAction(r, Number(r.visited_by_user) === 1 ? 'Open again' : 'Visit resource', 'btn')}</div>`).join('')}</div>`
          : '<p class="cc-empty-note">No learning resource has been assigned to this module yet. The trainer must add one before it can be completed.</p>';
        let actionHtml = '';
        if (completed) actionHtml = '<span class="cc-meta">Completed</span>';
        else if (allVisited) actionHtml = `<button class="btn primary" data-complete-module="${esc(m.id)}">Mark as complete</button>`;
        else actionHtml = `<button class="btn" disabled title="Visit all resources assigned to this module first">${resourceCount ? 'Visit resources first' : 'Resource not added yet'}</button>`;
        const progressText = completed ? 'Module completed' : `${visitedCount} of ${resourceCount} resources visited`;
        return `<article class="cc-list-item cc-learning-module"><div class="cc-module-main"><strong>${esc(m.title)}</strong><p>${esc(m.description || '')}</p><small class="cc-module-progress">${esc(progressText)}</small>${resourceHtml}</div><div class="cc-module-action">${actionHtml}</div></article>`;
      }).join('');
      const unassignedResources = resources.filter((r) => !r.module_id);
      box.innerHTML = `<h2>${esc(courseData.course.title)}</h2><p>${esc(courseData.course.description || '')}</p>
       <h3>Learning modules</h3><div class="cc-list">${moduleCards || '<p class="cc-empty-note">No modules have been added to this course yet.</p>'}</div>
       ${unassignedResources.length ? `<h3>Additional course resources</h3><div class="cc-list">${unassignedResources.map((r) => `<article class="cc-list-item"><div><strong>${esc(r.title)}</strong><span>${esc(r.resource_type)}</span><p>${esc(r.description || '')}</p></div>${resourceAction(r, 'Visit resource', 'btn')}</article>`).join('')}</div>` : ''}`;
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderResourceDetails() {
    const id = new URLSearchParams(location.search).get('id');
    const panel = findPrimaryPanel();
    if (!panel) return;
    try {
      const rows = (await api().get('/resources')).resources || [];
      const resource = rows.find((r) => String(r.id) === String(id));
      const box = liveContainer(panel, 'cc-resource-details');
      if (!resource) { box.innerHTML = '<p class="cc-empty-note">Select a resource from the Resources page to view it.</p>'; return; }
      box.innerHTML = `<h2>${esc(resource.title)}</h2><p>${esc(resource.description || '')}</p><p><strong>Course:</strong> ${esc(resource.course_title || '')} · <strong>Type:</strong> ${esc(resource.resource_type)}</p>${resourceAction(resource, 'Open resource', 'btn primary')}`;
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderTraineeCompetencies() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const rows = (await api().get('/competencies')).competencies || [];
      const grouped = new Map();
      rows.forEach((row) => {
        if (!grouped.has(Number(row.id))) grouped.set(Number(row.id), { ...row, courses: [] });
        grouped.get(Number(row.id)).courses.push(row);
      });
      const competencies = Array.from(grouped.values()).map((c) => {
        const courses = c.courses;
        const completed = courses.filter((course) => Number(course.is_enrolled) === 1 && Number(course.total_modules) > 0 && Number(course.completed_modules) >= Number(course.total_modules)).length;
        const assessed = courses.filter((course) => course.average_percentage !== null && course.average_percentage !== undefined && Number(course.evaluated_assessments) > 0);
        const gaps = assessed.filter((course) => Number(course.average_percentage) < 60);
        const average = assessed.length ? assessed.reduce((sum, course) => sum + Number(course.average_percentage), 0) / assessed.length : null;
        return { ...c, courses, completed, total: courses.length, progress: courses.length ? Math.round(completed / courses.length * 100) : 0, assessed, gaps, average };
      });
      const developed = competencies.filter((c) => c.progress === 100 && c.gaps.length === 0 && c.assessed.length > 0).length;
      const gapCount = competencies.reduce((sum, c) => sum + c.gaps.length, 0);
      const allScores = competencies.flatMap((c) => c.assessed.map((course) => Number(course.average_percentage)));
      const overallAverage = allScores.length ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1) : '—';
      updateStats({ 'Competencies Tracked': competencies.length, Developed: developed, 'Average Level': overallAverage === '—' ? '—' : `${overallAverage}%`, 'Skill Gaps': gapCount });
      const box = liveContainer(panel, 'cc-competencies-view');
      box.innerHTML = competencies.length ? competencies.map((c) => {
        const courseRows = c.courses.map((course) => {
          const enrolled = Number(course.is_enrolled) === 1;
          const totalModules = Number(course.total_modules || 0);
          const completedModules = Number(course.completed_modules || 0);
          const courseDone = enrolled && totalModules > 0 && completedModules >= totalModules;
          const scoreAvailable = course.average_percentage !== null && course.average_percentage !== undefined && Number(course.evaluated_assessments) > 0;
          const score = scoreAvailable ? Number(course.average_percentage) : null;
          const skillStatus = !enrolled ? 'Not enrolled' : !scoreAvailable ? 'Assessment pending' : score < 60 ? 'Skill gap identified' : 'Skill demonstrated';
          const badgeClass = !enrolled ? 'cc-meta' : !scoreAvailable ? 'cc-meta' : score < 60 ? 'cc-meta cc-gap' : 'cc-meta cc-good';
          const courseStatus = !enrolled ? 'Not enrolled' : courseDone ? 'Completed' : totalModules ? `${completedModules}/${totalModules} modules completed` : 'Learning not started';
          return `<div class="cc-competency-course"><div class="cc-competency-course-head"><strong>${esc(course.course_title)}</strong><span class="${courseDone ? 'cc-meta cc-good' : 'cc-meta'}">${esc(courseStatus)}</span></div><div class="cc-competency-course-foot"><span>${esc(skillStatus)}</span><span>${scoreAvailable ? `${score.toFixed(1)}% assessment average` : 'No evaluated assessment'}</span></div></div>`;
        }).join('');
        const gapHtml = c.gaps.length ? `<div class="cc-skill-gap"><strong>Skill gaps identified</strong><ul>${c.gaps.map((course) => `<li>${esc(course.course_title)}: ${Number(course.average_percentage).toFixed(1)}% — review the course materials and retry the assessment.</li>`).join('')}</ul></div>` : `<p class="cc-competency-note">${c.assessed.length ? 'No assessment-based skill gaps identified.' : 'Skill-gap analysis will appear after assessments are evaluated.'}</p>`;
        return `<article class="cc-competency-profile"><div class="cc-competency-profile-top"><span class="cc-competency-icon">🎯</span><span class="cc-meta">${c.progress === 100 ? 'All courses completed' : `${c.completed} of ${c.total} courses completed`} · ${c.progress}%</span></div><h3>${esc(c.name)}</h3><p>${esc(c.description || '')}</p><div class="cc-competency-progress"><span style="width:${c.progress}%"></span></div><div class="cc-competency-courses">${courseRows}</div>${gapHtml}</article>`;
      }).join('') : '<p class="cc-empty-note">No competencies are mapped to your courses yet.</p>';
    } catch (error) { toast(error.message, 'error'); }
  }

  async function renderReports() {
    const panel = findPrimaryPanel(); if (!panel) return;
    try {
      const data = await api().get('/reports/summary'); const s = data.summary || {};
      updateStats({ 'Learning Reports': s.courses, 'Training Reports': s.learners, 'Assessment Reports': s.assessments, 'Competency Reports': '—', 'Training Programs': s.courses, 'Active Learners': s.learners, 'Completion': '—', 'Average Score': s.average_score == null ? '—' : Number(s.average_score).toFixed(1) });
      const box = liveContainer(panel, 'cc-report-summary');
      box.innerHTML = `<div class="grid3">${cardMarkup({ title: 'Courses', subtitle: 'Courses created in the platform', meta: s.courses || 0 })}${cardMarkup({ title: 'Learners', subtitle: 'Unique enrolled learners', meta: s.learners || 0 })}${cardMarkup({ title: 'Assessment submissions', subtitle: 'Submitted assessment attempts', meta: s.submissions || 0 })}</div>`;
    } catch (error) { toast(error.message, 'error'); }
  }

  async function handleClick(event) {
    const target = event.target.closest('button, a'); if (!target) return;
    if (target.dataset.openResource) {
      event.preventDefault();
      const resourceId = target.dataset.openResource;
      // Open a window synchronously during the user click to avoid popup blockers.
      const popup = window.open('about:blank', '_blank');
      try {
        const token = localStorage.getItem('capacityConnectToken');
        if (!token) throw new Error('Please sign in again to open this resource.');
        const response = await fetch(`${api().baseUrl}/resources/${encodeURIComponent(resourceId)}/file`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          let detail = 'Unable to open this resource.';
          try {
            const result = await response.json();
            detail = result.message || result.detail || detail;
          } catch (_) { /* response was not JSON */ }
          if (response.status === 401) api().clearSession();
          throw new Error(detail);
        }
        const blob = await response.blob();
        if (user?.role === 'trainee' && target.dataset.moduleId) {
          await api().post(`/resources/${encodeURIComponent(resourceId)}/visit`, {});
        }
        const objectUrl = URL.createObjectURL(blob);
        if (popup && !popup.closed) {
          popup.location.href = objectUrl;
        } else {
          // If the browser blocks the new tab, download the authenticated file instead.
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = `capacity-connect-resource-${resourceId}`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          toast('Your browser blocked the preview tab, so the file was downloaded instead.', 'warning');
        }
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        if (page === 'course-learning.html' && user?.role === 'trainee') await renderCourseLearning();
      } catch (error) {
        if (popup && !popup.closed) popup.close();
        toast(error.message, 'error');
      }
      return;
    }
    if (target.dataset.visitResource) {
      event.preventDefault();
      const resourceId = target.dataset.visitResource;
      const resourceUrl = target.dataset.resourceUrl;
      const popup = window.open('about:blank', '_blank');
      try {
        await api().post(`/resources/${encodeURIComponent(resourceId)}/visit`, {});
        if (popup && !popup.closed) popup.location.href = resourceUrl;
        else window.location.href = resourceUrl;
        if (page === 'course-learning.html') await renderCourseLearning();
      } catch (error) {
        if (popup && !popup.closed) popup.close();
        toast(error.message, 'error');
      }
      return;
    }
    if (target.closest('.nav-bottom') && target.textContent.toLowerCase().includes('logout')) {
      event.preventDefault(); api().clearSession(); location.href = 'login.html'; return;
    }
    if (target.matches('[data-action="demo"]')) {
      event.preventDefault(); const label = target.textContent.toLowerCase();
      if (label.includes('explore courses')) { location.href = 'explore-courses.html'; return; }
      if (label.includes('my courses')) { location.href = 'my-course.html'; return; }
      if (label.includes('view resources')) { location.href = 'resources.html'; return; }
      if (label.includes('save as draft')) { return; }
      if (label.includes('user')) openUserModal(null);
      else if (label.includes('trainer')) openUserModal('trainer');
      else if (label.includes('trainee')) openUserModal('trainee');
      else if (label.includes('course')) openCourseModal();
      else if (label.includes('resource')) openResourceModal();
      else if (label.includes('assessment')) openAssessmentModal();
      else if (label.includes('competency')) openCompetencyModal();
      else if (label.includes('program')) openProgramModal();
      else if (label.includes('notification')) openNotificationModal();
      else if (label.includes('report')) renderReports();
      else if (label.includes('refresh')) renderNotifications();
      else toast('Select an available action on this page.', 'warning');
      return;
    }
    if (target.dataset.enroll) {
      try {
        const courseId = target.dataset.enroll;
        await api().post(`/courses/${courseId}/enroll`, {});
        toast('You are enrolled.');
        if (page === 'course-details.html') location.href = `course-learning.html?courseId=${courseId}`;
        else renderCourseList(page === 'my-course.html' ? 'my' : 'explore');
      } catch (error) { toast(error.message, 'error'); }
    }
    if (target.dataset.toggleUser) {
      try { await api().patch(`/users/${target.dataset.toggleUser}`, { is_active: Number(target.dataset.active) }); toast('User status updated.'); renderUsers(page === 'admin-trainers.html' ? 'trainer' : null); }
      catch (error) { toast(error.message, 'error'); }
    }
    if (target.dataset.deleteResource) {
      if (!confirm('Delete this resource?')) return;
      try { await api().delete(`/resources/${target.dataset.deleteResource}`); toast('Resource deleted.'); renderResources(); }
      catch (error) { toast(error.message, 'error'); }
    }
    if (target.dataset.deleteAssessment) {
      if (!confirm('Delete this assignment and all trainee submissions for it? This cannot be undone.')) return;
      try { await api().delete(`/assessments/${target.dataset.deleteAssessment}`); toast('Assignment deleted.'); await renderAssessments(); }
      catch (error) { toast(error.message, 'error'); }
    }
    if (target.dataset.submitAssessment) openSubmissionModal(target.dataset.submitAssessment).catch((e) => toast(e.message, 'error'));
    if (target.dataset.gradeSubmission) openGradeModal(target.dataset.gradeSubmission, target.dataset.total);
    if (target.dataset.setAnswerKey) openAnswerKeyModal(target.dataset.setAnswerKey).catch((e) => toast(e.message, 'error'));
    if (target.dataset.viewAssessmentResult) openAssessmentResultModal(target.dataset.viewAssessmentResult).catch((e) => toast(e.message, 'error'));
    if (target.dataset.completeModule) {
      try { await api().post(`/modules/${target.dataset.completeModule}/complete`, {}); toast('Module marked complete.'); renderCourseLearning(); }
      catch (error) { toast(error.message, 'error'); }
    }
    if (target.dataset.readNotification) {
      try { await api().post(`/notifications/${target.dataset.readNotification}/read`, {}); renderNotifications(); }
      catch (error) { toast(error.message, 'error'); }
    }
    if (target.dataset.programCourses) {
      const response = await api().get(`/programs/${target.dataset.programCourses}/courses`);
      showModal('Program courses', `<div class="cc-readonly-list">${(response.courses || []).map((c) => `<p>${esc(c.title)} · ${esc(c.category || '')}</p>`).join('') || '<p>No courses linked.</p>'}</div>`, async () => {}, 'Close');
    }
  }

  async function init() {
    document.addEventListener('click', (event) => { handleClick(event).catch((error) => toast(error.message, 'error')); });
    document.addEventListener('input', (event) => {
      if (!event.target.matches('[data-search]')) return;
      const selector = event.target.getAttribute('data-search');
      const term = event.target.value.toLowerCase().trim();
      $$(selector).forEach((item) => { item.style.display = item.textContent.toLowerCase().includes(term) ? '' : 'none'; });
    });
    document.addEventListener('change', async (event) => {
      if (event.target.matches('[data-course-status]')) {
        try { await api().patch(`/courses/${event.target.dataset.courseStatus}`, { status: event.target.value }); toast('Course status updated.'); }
        catch (error) { toast(error.message, 'error'); }
      }
    });

    if (!protectedPages) return;
    if (!localStorage.getItem('capacityConnectToken')) { location.href = 'login.html'; return; }
    try {
      const result = await api().get('/auth/me');
      const activeUser = result.user;
      localStorage.setItem('capacityConnectUser', JSON.stringify(activeUser));
      if (rolePage && activeUser.role !== rolePage && !(page === 'create-course.html' && activeUser.role === 'administrator')) {
        location.href = roleHome[activeUser.role]; return;
      }
      const profile = $('.profile');
      if (profile) { const strong = $('strong', profile); const span = $('span', profile); if (strong) strong.textContent = activeUser.name; if (span) span.textContent = `${activeUser.role[0].toUpperCase() + activeUser.role.slice(1)} · ${activeUser.email}`; }
      await runPage();
    } catch (error) {
      api().clearSession(); toast(error.message, 'error'); setTimeout(() => { location.href = 'login.html'; }, 900);
    }
  }

  async function runPage() {
    if (page === 'admin-dashboard.html' || page === 'trainer-dashboard.html' || page === 'trainee-dashboard.html') await renderDashboard();
    else if (page === 'admin-users.html') await renderUsers();
    else if (page === 'admin-trainers.html') await renderUsers('trainer');
    else if (page === 'admin-courses.html') await renderCourseList('admin');
    else if (page === 'trainer-courses.html') await renderCourseList('trainer');
    else if (page === 'explore-courses.html') await renderCourseList('explore');
    else if (page === 'my-course.html') await renderCourseList('my');
    else if (page === 'create-course.html') setupCourseCreatePage();
    else if (page === 'trainer-resources.html' || page === 'admin-resources.html' || page === 'resources.html') await renderResources();
    else if (page === 'trainer-competencies.html' || page === 'admin-competencies.html') await renderCompetencies();
    else if (page === 'competencies.html') await renderTraineeCompetencies();
    else if (page === 'trainer-assessments.html' || page === 'admin-assessments.html' || page === 'assessments.html') await renderAssessments();
    else if (page === 'my-progress.html') await renderProgress();
    else if (page === 'trainer-trainees.html') await renderTrainees();
    else if (page === 'admin-training-programs.html') await renderPrograms();
    else if (page === 'notifications.html' || page === 'trainer-notifications.html' || page === 'admin-notifications.html') await renderNotifications();
    else if (page === 'feedback.html') { await setupFeedback(); await renderFeedback(); }
    else if (page === 'settings.html' || page === 'trainer-settings.html') await setupSettings();
    else if (page === 'admin-settings.html') await setupAdminSettings();
    else if (page === 'course-details.html') await renderCourseDetails();
    else if (page === 'course-learning.html') await renderCourseLearning();
    else if (page === 'admin-reports.html' || page === 'trainer-analytics.html') await renderReports();
    else if (page === 'resource-details.html') await renderResourceDetails();
  }

  async function setupCourseCreatePage() {
    const form = $('form[data-demo-form]'); if (!form) return;
    form.removeAttribute('data-demo-form');
    const editId = new URLSearchParams(location.search).get('id');
    const inputs = $$('input', form), selects = $$('select', form), textareas = $$('textarea', form);
    if (editId) {
      try {
        const { course } = await api().get(`/courses/${editId}`);
        if (inputs[0]) inputs[0].value = course.title || '';
        if (selects[0]) selects[0].value = course.category || 'Technical Skills';
        if (textareas[0]) textareas[0].value = course.description || '';
        if (selects[1]) selects[1].value = course.difficulty || 'Beginner';
        if (inputs[1]) inputs[1].value = course.duration || '';
        if (inputs[2]) inputs[2].value = course.max_learners || '';
        if (selects[2]) selects[2].value = (course.status || 'draft').replace(/^./, c => c.toUpperCase());
        if (textareas[1]) textareas[1].value = course.objectives || '';
        const moduleData = await api().get(`/modules?courseId=${editId}`);
        if (textareas[2]) textareas[2].value = (moduleData.modules || []).map(m => m.title).join('\n');
        const heading = $('h1'); if (heading) heading.textContent = 'Edit Course';
        const button = $('button[type="submit"]', form); if (button) button.textContent = 'Update Course';
      } catch (error) { toast(error.message, 'error'); }
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = { title: inputs[0]?.value, category: selects[0]?.value, description: textareas[0]?.value, difficulty: selects[1]?.value, duration: inputs[1]?.value, max_learners: inputs[2]?.value || null, status: selects[2]?.value?.toLowerCase() || 'draft', objectives: textareas[1]?.value || '' };
      const msg = $('#courseMsg');
      try {
        let courseId = editId;
        if (editId) await api().patch(`/courses/${editId}`, body);
        else { const result = await api().post('/courses', body); courseId = result.courseId; }
        const moduleLines = String(textareas[2]?.value || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (editId) await api().put(`/modules/course/${editId}`, { modules: moduleLines });
        else {
          for (let i = 0; i < moduleLines.length; i++) await api().post('/modules', { course_id: courseId, title: moduleLines[i], sort_order: i + 1 });
        }
        setMessage(msg, `${editId ? 'Course updated' : 'Course saved'} successfully (ID: ${courseId}).`);
        if (!editId) form.reset();
      } catch (error) { setMessage(msg, error.message, 'warning'); }
    });
    const draft = $$('button', form).find((b) => b.textContent.toLowerCase().includes('draft'));
    if (draft) draft.addEventListener('click', async () => {
      const body = { title: inputs[0]?.value, category: selects[0]?.value, description: textareas[0]?.value || 'Draft course', difficulty: selects[1]?.value, duration: inputs[1]?.value, status: 'draft', objectives: textareas[1]?.value || '' };
      try {
        const result = editId ? await api().patch(`/courses/${editId}`, body) : await api().post('/courses', body);
        setMessage($('#courseMsg'), `Draft saved (Course ID: ${editId || result.courseId}).`);
      } catch (error) { setMessage($('#courseMsg'), error.message, 'warning'); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
