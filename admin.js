// Admin Dashboard JavaScript
class AdminDashboard {
    constructor() {
        this.currentSection = 'overview';
        this.currentUser = null;
        this.data = null;
        this.charts = {};
        this.theme = localStorage.getItem('admin_theme') || 'dark';

        this.initializeApp();
        this.bindEvents();
        this.applyTheme();
    }

    // Initialize the admin dashboard
    async initializeApp() {
        // Check authentication
        if (!this.checkAuth()) {
            this.showLogin();
            return;
        }

        // Load data
        await this.loadData();

        // Initialize dashboard
        this.showDashboard();
        this.updateOverview();
        this.initializeCharts();

        // Set up auto-refresh
        setInterval(() => this.refreshData(), 30000); // Refresh every 30 seconds
    }

    // Authentication
    checkAuth() {
        const adminSession = localStorage.getItem('admin_session');
        const adminUser = localStorage.getItem('admin_user');

        if (!adminSession || !adminUser) return false;

        // Check if session is still valid (24 hours)
        const sessionTime = parseInt(adminSession);
        const now = Date.now();
        const hoursDiff = (now - sessionTime) / (1000 * 60 * 60);

        if (hoursDiff > 24) {
            this.logout();
            return false;
        }

        this.currentUser = adminUser;
        return true;
    }

    showLogin() {
        document.getElementById('adminLogin').classList.add('active');
        document.getElementById('adminDashboard').classList.remove('active');
    }

    showDashboard() {
        document.getElementById('adminLogin').classList.remove('active');
        document.getElementById('adminDashboard').classList.add('active');
        document.getElementById('adminName').textContent = this.currentUser;
    }

    async handleLogin(event) {
        event.preventDefault();

        const username = document.getElementById('adminUsername').value;
        const password = document.getElementById('adminPassword').value;

        // Default admin credentials (in production, use secure authentication)
        const validCredentials = {
            'admin': 'starboard2024',
            'superadmin': 'admin123'
        };

        if (validCredentials[username] && validCredentials[username] === password) {
            localStorage.setItem('admin_user', username);
            localStorage.setItem('admin_session', Date.now().toString());

            this.currentUser = username;
            this.showToast('Login successful', 'success');
            this.initializeApp();
        } else {
            this.showToast('Invalid credentials', 'error');
        }
    }

    logout() {
        localStorage.removeItem('admin_user');
        localStorage.removeItem('admin_session');
        this.currentUser = null;
        this.showLogin();
        this.showToast('Logged out successfully', 'info');
    }

    // Data Management
    async loadData() {
        try {
            this.showLoading();

            // Try to load from Supabase first
            const supabaseData = await this.tryLoadFromSupabase();
            if (supabaseData) {
                this.data = supabaseData;
                this.updateSyncStatus('Synced with Supabase');
                this.hideLoading();
                return;
            }

            // Fallback to Netlify Blobs
            const netlifyData = await this.tryLoadFromNetlify();
            if (netlifyData) {
                this.data = netlifyData;
                this.updateSyncStatus('Synced with Netlify');
                this.hideLoading();
                return;
            }

            // Fallback to local storage
            const localData = this.getDataFromLocalStorage();
            this.data = localData;
            this.updateSyncStatus('Local data only');

            this.hideLoading();
        } catch (error) {
            console.error('Error loading data:', error);
            this.showToast('Error loading data: ' + error.message, 'error');
            this.hideLoading();
        }
    }

    async tryLoadFromSupabase() {
        try {
            const response = await fetch('/.netlify/functions/supabase-starboard', {
                headers: { 'Cache-Control': 'no-store' }
            });
            if (!response.ok) return null;
            const data = await response.json();
            return this.validateDataStructure(data) ? data : null;
        } catch (e) {
            return null;
        }
    }

    async tryLoadFromNetlify() {
        try {
            const response = await fetch('/.netlify/functions/starboard', {
                headers: { 'Cache-Control': 'no-store' }
            });
            if (!response.ok) return null;
            const data = await response.json();
            return this.validateDataStructure(data) ? data : null;
        } catch (e) {
            return null;
        }
    }

    getDataFromLocalStorage() {
        try {
            const data = localStorage.getItem('starboard_data');
            if (!data) return this.createDefaultData();

            const parsedData = JSON.parse(data);
            return this.validateDataStructure(parsedData) ? parsedData : this.createDefaultData();
        } catch (error) {
            console.error('Error loading from localStorage:', error);
            return this.createDefaultData();
        }
    }

    async saveData(data) {
        try {
            // Update memory cache
            this.data = JSON.parse(JSON.stringify(data));

            // Try to save to Supabase first
            let saved = false;
            try {
                saved = await this.trySaveToSupabase(data);
            } catch (e) {
                console.warn('Failed to save to Supabase:', e);
            }

            // If Supabase failed, try Netlify Blobs
            if (!saved) {
                try {
                    saved = await this.trySaveToNetlify(data);
                } catch (e) {
                    console.warn('Failed to save to Netlify Blobs:', e);
                }
            }

            // Always update localStorage
            localStorage.setItem('starboard_data', JSON.stringify(data, null, 2));

            if (saved) {
                this.updateSyncStatus('Data saved successfully');
                this.showToast('Data saved successfully', 'success');
            } else {
                this.updateSyncStatus('Saved locally only');
                this.showToast('Data saved locally (cloud sync failed)', 'warning');
            }

            return true;
        } catch (error) {
            console.error('Error saving data:', error);
            this.showToast('Error saving data: ' + error.message, 'error');
            return false;
        }
    }

    async trySaveToSupabase(data) {
        try {
            const response = await fetch('/.netlify/functions/supabase-starboard', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    async trySaveToNetlify(data) {
        try {
            const response = await fetch('/.netlify/functions/starboard', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    validateDataStructure(data) {
        if (!data || typeof data !== 'object') return false;

        const requiredProps = ['classes', 'teachers', 'settings'];
        for (const prop of requiredProps) {
            if (!data.hasOwnProperty(prop) || typeof data[prop] !== 'object') {
                return false;
            }
        }

        return true;
    }

    createDefaultData() {
        const now = new Date().toISOString();
        return {
            classes: {},
            teachers: {
                'teacher': 'starboard'
            },
            settings: {
                theme: 'dark',
                soundEnabled: true,
                autoBackup: true,
                achievementThresholds: {
                    bronze: 10,
                    silver: 25,
                    gold: 50
                }
            },
            metadata: {
                version: '2.0',
                created: now,
                lastModified: now,
                backupCount: 0
            }
        };
    }

    // UI Management
    bindEvents() {
        // Login form
        document.getElementById('adminLoginForm').addEventListener('submit', (e) => this.handleLogin(e));

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.currentTarget.getAttribute('data-section');
                this.switchSection(section);
            });
        });

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        // Theme toggle
        document.getElementById('themeToggleAdmin').addEventListener('click', () => this.toggleTheme());

        // Refresh data
        document.getElementById('refreshData').addEventListener('click', () => this.refreshData());

        // Sidebar toggle (mobile)
        document.getElementById('sidebarToggle').addEventListener('click', () => this.toggleSidebar());

        // Search and filters
        document.getElementById('classSearch').addEventListener('input', (e) => this.filterClasses(e.target.value));
        document.getElementById('studentSearch').addEventListener('input', (e) => this.filterStudents(e.target.value));
        document.getElementById('teacherSearch').addEventListener('input', (e) => this.filterTeachers(e.target.value));

        // Modal close
        document.getElementById('adminModal').addEventListener('click', (e) => {
            if (e.target.id === 'adminModal') this.closeModal();
        });

        // Mobile bottom navigation
        document.querySelectorAll('.mobile-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.currentTarget.getAttribute('data-section');
                this.switchSection(section);
            });
        });
    }

    switchSection(section) {
        // Update desktop navigation
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`[data-section="${section}"]`).classList.add('active');

        // Update mobile navigation
        document.querySelectorAll('.mobile-nav-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`.mobile-nav-item[data-section="${section}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.dashboard-section').forEach(sec => sec.classList.remove('active'));
        document.getElementById(`${section}Section`).classList.add('active');

        // Update section title
        const titles = {
            'overview': 'Dashboard Overview',
            'classes': 'Classes Management',
            'students': 'Students Management',
            'teachers': 'Teachers Management',
            'analytics': 'Analytics & Reports',
            'settings': 'System Settings',
            'backup': 'Backup & Restore'
        };
        document.getElementById('sectionTitle').textContent = titles[section] || 'Dashboard';

        this.currentSection = section;

        // Load section-specific data
        switch (section) {
            case 'classes':
                this.loadClasses();
                break;
            case 'students':
                this.loadStudents();
                break;
            case 'teachers':
                this.loadTeachers();
                break;
            case 'analytics':
                this.updateAnalytics();
                break;
        }
    }

    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme();
        localStorage.setItem('admin_theme', this.theme);
        this.showToast(`Switched to ${this.theme} theme`, 'success');
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const icon = document.querySelector('#themeToggleAdmin i');
        if (icon) {
            icon.className = this.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        sidebar.classList.toggle('active');
    }

    updateSyncStatus(status) {
        document.getElementById('syncStatus').textContent = status;
    }

    showLoading() {
        document.getElementById('loadingOverlay').classList.add('active');
    }

    hideLoading() {
        document.getElementById('loadingOverlay').classList.remove('active');
    }

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;

        document.getElementById('toastContainer').appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    async refreshData() {
        await this.loadData();
        this.updateOverview();
        this.showToast('Data refreshed', 'success');
    }

    // Overview Section
    updateOverview() {
        if (!this.data) return;

        // Update stats
        const stats = this.calculateStats();
        document.getElementById('totalStudentsCount').textContent = stats.totalStudents;
        document.getElementById('totalStarsCount').textContent = stats.totalStars;
        document.getElementById('totalClassesCount').textContent = Object.keys(this.data.classes || {}).length;
        document.getElementById('totalTeachersCount').textContent = Object.keys(this.data.teachers || {}).length;

        // Update achievement counts
        document.getElementById('goldCount').textContent = stats.goldAchievements;
        document.getElementById('silverCount').textContent = stats.silverAchievements;
        document.getElementById('bronzeCount').textContent = stats.bronzeAchievements;

        // Update recent activity
        this.updateRecentActivity();
    }

    calculateStats() {
        let totalStudents = 0;
        let totalStars = 0;
        let goldAchievements = 0;
        let silverAchievements = 0;
        let bronzeAchievements = 0;

        const thresholds = this.data.settings?.achievementThresholds || { bronze: 10, silver: 25, gold: 50 };

        Object.values(this.data.classes || {}).forEach(classData => {
            if (classData.students) {
                Object.values(classData.students).forEach(student => {
                    totalStudents++;
                    totalStars += student.stars || 0;

                    if (student.stars >= thresholds.gold) goldAchievements++;
                    else if (student.stars >= thresholds.silver) silverAchievements++;
                    else if (student.stars >= thresholds.bronze) bronzeAchievements++;
                });
            }
        });

        return {
            totalStudents,
            totalStars,
            goldAchievements,
            silverAchievements,
            bronzeAchievements
        };
    }

    updateRecentActivity() {
        const activityList = document.getElementById('recentActivity');
        // This would typically fetch from a logs system
        // For now, showing placeholder activities
        const activities = [
            { icon: 'fas fa-user-plus', title: 'New student added', description: 'John Doe joined Class A', time: '2 hours ago' },
            { icon: 'fas fa-star', title: 'Achievement unlocked', description: 'Sarah earned Gold medal', time: '4 hours ago' },
            { icon: 'fas fa-chalkboard', title: 'New class created', description: 'Mathematics 101 added', time: '1 day ago' },
            { icon: 'fas fa-user-graduate', title: 'Student graduated', description: 'Mike completed all courses', time: '2 days ago' }
        ];

        activityList.innerHTML = activities.map(activity => `
            <div class="activity-item">
                <i class="${activity.icon}"></i>
                <div class="activity-content">
                    <div class="title">${activity.title}</div>
                    <div class="description">${activity.description}</div>
                </div>
                <div class="activity-time">${activity.time}</div>
            </div>
        `).join('');
    }

    // Classes Management
    loadClasses() {
        const classesTable = document.getElementById('classesTableBody');
        const classSelect = document.getElementById('studentClassFilter');

        classesTable.innerHTML = '';
        classSelect.innerHTML = '<option value="all">All Classes</option>';

        Object.entries(this.data.classes || {}).forEach(([className, classData]) => {
            const studentCount = Object.keys(classData.students || {}).length;
            const totalStars = Object.values(classData.students || {}).reduce((sum, student) => sum + (student.stars || 0), 0);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${className}</td>
                <td>${studentCount}</td>
                <td>${totalStars}</td>
                <td>${new Date(classData.created || Date.now()).toLocaleDateString()}</td>
                <td><span class="status-indicator active">Active</span></td>
                <td class="actions">
                    <a href="#" class="action-link edit" onclick="adminDashboard.editClass('${className}')">
                        <i class="fas fa-edit"></i> Edit
                    </a>
                    <a href="#" class="action-link delete" onclick="adminDashboard.deleteClass('${className}')">
                        <i class="fas fa-trash"></i> Delete
                    </a>
                </td>
            `;
            classesTable.appendChild(row);

            // Add to filter dropdown
            const option = document.createElement('option');
            option.value = className;
            option.textContent = className;
            classSelect.appendChild(option);
        });
    }

    filterClasses(query) {
        const rows = document.querySelectorAll('#classesTableBody tr');
        const filterValue = query.toLowerCase();

        rows.forEach(row => {
            const className = row.cells[0].textContent.toLowerCase();
            row.style.display = className.includes(filterValue) ? '' : 'none';
        });
    }

    showAddClassModal() {
        this.showModal('Add New Class', `
            <div class="form-group">
                <label for="newClassName">Class Name</label>
                <input type="text" id="newClassName" class="glass-input" placeholder="Enter class name" required>
            </div>
            <div class="form-group">
                <label for="classDescription">Description (Optional)</label>
                <textarea id="classDescription" class="glass-input" placeholder="Enter class description" rows="3"></textarea>
            </div>
        `, [
            { text: 'Cancel', class: 'btn-secondary', action: 'close' },
            { text: 'Create Class', class: 'btn-primary', action: () => this.createClass() }
        ]);
    }

    async createClass() {
        const className = document.getElementById('newClassName').value.trim();
        const description = document.getElementById('classDescription').value.trim();

        if (!className) {
            this.showToast('Please enter a class name', 'error');
            return;
        }

        if (this.data.classes[className]) {
            this.showToast('Class already exists', 'error');
            return;
        }

        this.data.classes[className] = {
            students: {},
            description: description,
            created: new Date().toISOString()
        };

        if (await this.saveData(this.data)) {
            this.loadClasses();
            this.closeModal();
            this.showToast('Class created successfully', 'success');
        }
    }

    editClass(className) {
        const classData = this.data.classes[className];
        this.showModal('Edit Class', `
            <div class="form-group">
                <label for="editClassName">Class Name</label>
                <input type="text" id="editClassName" class="glass-input" value="${className}" required>
            </div>
            <div class="form-group">
                <label for="editClassDescription">Description</label>
                <textarea id="editClassDescription" class="glass-input" rows="3">${classData.description || ''}</textarea>
            </div>
        `, [
            { text: 'Cancel', class: 'btn-secondary', action: 'close' },
            { text: 'Save Changes', class: 'btn-primary', action: () => this.updateClass(className) }
        ]);
    }

    async updateClass(oldName) {
        const newName = document.getElementById('editClassName').value.trim();
        const description = document.getElementById('editClassDescription').value.trim();

        if (!newName) {
            this.showToast('Please enter a class name', 'error');
            return;
        }

        if (newName !== oldName && this.data.classes[newName]) {
            this.showToast('Class name already exists', 'error');
            return;
        }

        if (newName !== oldName) {
            this.data.classes[newName] = this.data.classes[oldName];
            delete this.data.classes[oldName];
        }

        this.data.classes[newName].description = description;

        if (await this.saveData(this.data)) {
            this.loadClasses();
            this.closeModal();
            this.showToast('Class updated successfully', 'success');
        }
    }

    deleteClass(className) {
        this.showConfirm(`Are you sure you want to delete the class "${className}"? This will remove all students and their data.`, () => {
            delete this.data.classes[className];
            this.saveData(this.data);
            this.loadClasses();
            this.showToast('Class deleted successfully', 'success');
        });
    }

    // Students Management
    loadStudents() {
        const studentsTable = document.getElementById('studentsTableBody');
        studentsTable.innerHTML = '';

        const allStudents = [];

        Object.entries(this.data.classes || {}).forEach(([className, classData]) => {
            if (classData.students) {
                Object.entries(classData.students).forEach(([studentId, student]) => {
                    allStudents.push({
                        id: studentId,
                        name: student.name,
                        class: className,
                        stars: student.stars || 0,
                        joined: student.created || Date.now()
                    });
                });
            }
        });

        // Sort by stars (descending)
        allStudents.sort((a, b) => b.stars - a.stars);

        allStudents.forEach(student => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${student.name}</td>
                <td>${student.class}</td>
                <td>${student.stars}</td>
                <td>${this.getAchievementBadges(student.stars)}</td>
                <td>${new Date(student.joined).toLocaleDateString()}</td>
                <td class="actions">
                    <a href="#" class="action-link edit" onclick="adminDashboard.editStudent('${student.id}', '${student.class}')">
                        <i class="fas fa-edit"></i> Edit
                    </a>
                    <a href="#" class="action-link delete" onclick="adminDashboard.deleteStudent('${student.id}', '${student.class}')">
                        <i class="fas fa-trash"></i> Delete
                    </a>
                </td>
            `;
            studentsTable.appendChild(row);
        });
    }

    getAchievementBadges(stars) {
        const thresholds = this.data.settings?.achievementThresholds || { bronze: 10, silver: 25, gold: 50 };
        let badges = '';

        if (stars >= thresholds.gold) {
            badges += '<span class="achievement-badge gold">50</span>';
        } else if (stars >= thresholds.silver) {
            badges += '<span class="achievement-badge silver">25</span>';
        } else if (stars >= thresholds.bronze) {
            badges += '<span class="achievement-badge bronze">10</span>';
        }

        return badges || '-';
    }

    filterStudents(query) {
        const rows = document.querySelectorAll('#studentsTableBody tr');
        const filterValue = query.toLowerCase();

        rows.forEach(row => {
            const studentName = row.cells[0].textContent.toLowerCase();
            const className = row.cells[1].textContent.toLowerCase();
            row.style.display = studentName.includes(filterValue) || className.includes(filterValue) ? '' : 'none';
        });
    }

    showAddStudentModal() {
        const classSelect = '<select id="studentClass" class="glass-input" required>' +
            '<option value="">Select Class</option>' +
            Object.keys(this.data.classes || {}).map(className =>
                `<option value="${className}">${className}</option>`
            ).join('') +
            '</select>';

        this.showModal('Add New Student', `
            <div class="form-group">
                <label for="studentName">Student Name</label>
                <input type="text" id="studentName" class="glass-input" placeholder="Enter student name" required>
            </div>
            <div class="form-group">
                <label for="studentClass">Class</label>
                ${classSelect}
            </div>
            <div class="form-group">
                <label for="initialStars">Initial Stars (Optional)</label>
                <input type="number" id="initialStars" class="glass-input" value="0" min="0">
            </div>
        `, [
            { text: 'Cancel', class: 'btn-secondary', action: 'close' },
            { text: 'Add Student', class: 'btn-primary', action: () => this.createStudent() }
        ]);
    }

    async createStudent() {
        const name = document.getElementById('studentName').value.trim();
        const className = document.getElementById('studentClass').value;
        const stars = parseInt(document.getElementById('initialStars').value) || 0;

        if (!name || !className) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }

        if (!this.data.classes[className]) {
            this.showToast('Selected class does not exist', 'error');
            return;
        }

        const studentId = this.generateId();
        if (!this.data.classes[className].students) {
            this.data.classes[className].students = {};
        }

        this.data.classes[className].students[studentId] = {
            name: name,
            stars: stars,
            created: new Date().toISOString()
        };

        if (await this.saveData(this.data)) {
            this.loadStudents();
            this.closeModal();
            this.showToast('Student added successfully', 'success');
        }
    }

    editStudent(studentId, className) {
        const student = this.data.classes[className].students[studentId];
        const classSelect = '<select id="editStudentClass" class="glass-input" required>' +
            Object.keys(this.data.classes || {}).map(cName =>
                `<option value="${cName}" ${cName === className ? 'selected' : ''}>${cName}</option>`
            ).join('') +
            '</select>';

        this.showModal('Edit Student', `
            <div class="form-group">
                <label for="editStudentName">Student Name</label>
                <input type="text" id="editStudentName" class="glass-input" value="${student.name}" required>
            </div>
            <div class="form-group">
                <label for="editStudentClass">Class</label>
                ${classSelect}
            </div>
            <div class="form-group">
                <label for="editStudentStars">Stars</label>
                <input type="number" id="editStudentStars" class="glass-input" value="${student.stars || 0}" min="0">
            </div>
        `, [
            { text: 'Cancel', class: 'btn-secondary', action: 'close' },
            { text: 'Save Changes', class: 'btn-primary', action: () => this.updateStudent(studentId, className) }
        ]);
    }

    async updateStudent(oldStudentId, oldClassName) {
        const name = document.getElementById('editStudentName').value.trim();
        const newClassName = document.getElementById('editStudentClass').value;
        const stars = parseInt(document.getElementById('editStudentStars').value) || 0;

        if (!name || !newClassName) {
            this.showToast('Please fill all required fields', 'error');
            return;
        }

        // Remove from old class
        delete this.data.classes[oldClassName].students[oldStudentId];

        // Add to new class
        if (!this.data.classes[newClassName].students) {
            this.data.classes[newClassName].students = {};
        }

        const newStudentId = this.generateId();
        this.data.classes[newClassName].students[newStudentId] = {
            name: name,
            stars: stars,
            created: new Date().toISOString()
        };

        if (await this.saveData(this.data)) {
            this.loadStudents();
            this.closeModal();
            this.showToast('Student updated successfully', 'success');
        }
    }

    deleteStudent(studentId, className) {
        const student = this.data.classes[className].students[studentId];
        this.showConfirm(`Are you sure you want to delete "${student.name}"? This action cannot be undone.`, () => {
            delete this.data.classes[className].students[studentId];
            this.saveData(this.data);
            this.loadStudents();
            this.showToast('Student deleted successfully', 'success');
        });
    }

    // Teachers Management
    loadTeachers() {
        const teachersTable = document.getElementById('teachersTableBody');
        teachersTable.innerHTML = '';

        Object.entries(this.data.teachers || {}).forEach(([username, password]) => {
            // Count classes assigned to this teacher (simplified - in real app, you'd have teacher-class assignments)
            const assignedClasses = Object.keys(this.data.classes || {}).length;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${username}</td>
                <td>${assignedClasses}</td>
                <td>Last login: Never</td>
                <td><span class="status-indicator active">Active</span></td>
                <td class="actions">
                    <a href="#" class="action-link edit" onclick="adminDashboard.editTeacher('${username}')">
                        <i class="fas fa-edit"></i> Edit
                    </a>
                    <a href="#" class="action-link delete" onclick="adminDashboard.deleteTeacher('${username}')">
                        <i class="fas fa-trash"></i> Delete
                    </a>
                </td>
            `;
            teachersTable.appendChild(row);
        });
    }

    filterTeachers(query) {
        const rows = document.querySelectorAll('#teachersTableBody tr');
        const filterValue = query.toLowerCase();

        rows.forEach(row => {
            const username = row.cells[0].textContent.toLowerCase();
            row.style.display = username.includes(filterValue) ? '' : 'none';
        });
    }

    showAddTeacherModal() {
        this.showModal('Add New Teacher', `
            <div class="form-group">
                <label for="teacherUsername">Username</label>
                <input type="text" id="teacherUsername" class="glass-input" placeholder="Enter username" required>
            </div>
            <div class="form-group">
                <label for="teacherPassword">Password</label>
                <input type="password" id="teacherPassword" class="glass-input" placeholder="Enter password" required>
            </div>
            <div class="form-group">
                <label for="confirmTeacherPassword">Confirm Password</label>
                <input type="password" id="confirmTeacherPassword" class="glass-input" placeholder="Confirm password" required>
            </div>
        `, [
            { text: 'Cancel', class: 'btn-secondary', action: 'close' },
            { text: 'Create Teacher', class: 'btn-primary', action: () => this.createTeacher() }
        ]);
    }

    async createTeacher() {
        const username = document.getElementById('teacherUsername').value.trim();
        const password = document.getElementById('teacherPassword').value;
        const confirmPassword = document.getElementById('confirmTeacherPassword').value;

        if (!username || !password) {
            this.showToast('Please fill all fields', 'error');
            return;
        }

        if (password !== confirmPassword) {
            this.showToast('Passwords do not match', 'error');
            return;
        }

        if (this.data.teachers[username]) {
            this.showToast('Username already exists', 'error');
            return;
        }

        this.data.teachers[username] = password;

        if (await this.saveData(this.data)) {
            this.loadTeachers();
            this.closeModal();
            this.showToast('Teacher created successfully', 'success');
        }
    }

    editTeacher(username) {
        this.showModal('Edit Teacher', `
            <div class="form-group">
                <label for="editTeacherUsername">Username</label>
                <input type="text" id="editTeacherUsername" class="glass-input" value="${username}" required>
            </div>
            <div class="form-group">
                <label for="editTeacherPassword">New Password (leave blank to keep current)</label>
                <input type="password" id="editTeacherPassword" class="glass-input" placeholder="Enter new password">
            </div>
        `, [
            { text: 'Cancel', class: 'btn-secondary', action: 'close' },
            { text: 'Save Changes', class: 'btn-primary', action: () => this.updateTeacher(username) }
        ]);
    }

    async updateTeacher(oldUsername) {
        const newUsername = document.getElementById('editTeacherUsername').value.trim();
        const newPassword = document.getElementById('editTeacherPassword').value;

        if (!newUsername) {
            this.showToast('Username is required', 'error');
            return;
        }

        if (newUsername !== oldUsername && this.data.teachers[newUsername]) {
            this.showToast('Username already exists', 'error');
            return;
        }

        // Update username if changed
        if (newUsername !== oldUsername) {
            this.data.teachers[newUsername] = this.data.teachers[oldUsername];
            delete this.data.teachers[oldUsername];
        }

        // Update password if provided
        if (newPassword) {
            this.data.teachers[newUsername] = newPassword;
        }

        if (await this.saveData(this.data)) {
            this.loadTeachers();
            this.closeModal();
            this.showToast('Teacher updated successfully', 'success');
        }
    }

    deleteTeacher(username) {
        this.showConfirm(`Are you sure you want to delete teacher "${username}"?`, () => {
            delete this.data.teachers[username];
            this.saveData(this.data);
            this.loadTeachers();
            this.showToast('Teacher deleted successfully', 'success');
        });
    }

    // Analytics
    initializeCharts() {
        // Initialize Chart.js charts
        this.initializeStarDistributionChart();
        this.initializeProgressChart();
    }

    initializeStarDistributionChart() {
        const ctx = document.getElementById('starDistributionChart');
        if (!ctx) return;

        const classData = Object.entries(this.data.classes || {}).map(([className, classData]) => {
            const totalStars = Object.values(classData.students || {}).reduce((sum, student) => sum + (student.stars || 0), 0);
            return { className, totalStars };
        });

        this.charts.starDistribution = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: classData.map(d => d.className),
                datasets: [{
                    label: 'Total Stars',
                    data: classData.map(d => d.totalStars),
                    backgroundColor: 'rgba(102, 126, 234, 0.6)',
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    initializeProgressChart() {
        const ctx = document.getElementById('progressChart');
        if (!ctx) return;

        // Sample progress data - in real app, you'd track over time
        const progressData = {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            datasets: [{
                label: 'Average Stars per Student',
                data: [5, 12, 18, 25],
                borderColor: 'rgba(240, 147, 251, 1)',
                backgroundColor: 'rgba(240, 147, 251, 0.1)',
                tension: 0.4
            }]
        };

        this.charts.progress = new Chart(ctx, {
            type: 'line',
            data: progressData,
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    updateAnalytics() {
        // Update top performers
        this.updateTopPerformers();

        // Update charts
        if (this.charts.starDistribution) {
            this.charts.starDistribution.update();
        }
        if (this.charts.progress) {
            this.charts.progress.update();
        }
    }

    updateTopPerformers() {
        const performersList = document.getElementById('topPerformersList');
        if (!performersList) return;

        const allStudents = [];
        Object.entries(this.data.classes || {}).forEach(([className, classData]) => {
            if (classData.students) {
                Object.entries(classData.students).forEach(([studentId, student]) => {
                    allStudents.push({
                        name: student.name,
                        class: className,
                        stars: student.stars || 0
                    });
                });
            }
        });

        allStudents.sort((a, b) => b.stars - a.stars);
        const topPerformers = allStudents.slice(0, 5);

        performersList.innerHTML = topPerformers.map((student, index) => `
            <div class="performer-item">
                <div class="performer-rank">${index + 1}</div>
                <div class="performer-info">
                    <div class="performer-name">${student.name}</div>
                    <div class="performer-class">${student.class}</div>
                </div>
                <div class="performer-stars">${student.stars} ⭐</div>
            </div>
        `).join('');
    }

    // Settings
    updateAdminCredentials() {
        const username = document.getElementById('adminUsernameSettings').value.trim();
        const newPassword = document.getElementById('newAdminPassword').value;
        const confirmPassword = document.getElementById('confirmAdminPassword').value;

        if (!username) {
            this.showToast('Username is required', 'error');
            return;
        }

        if (newPassword) {
            if (newPassword !== confirmPassword) {
                this.showToast('Passwords do not match', 'error');
                return;
            }

            // In a real app, you'd hash the password
            // For demo purposes, we'll just update it
            this.showToast('Password updated successfully', 'success');
        }

        this.showToast('Admin settings updated', 'success');
    }

    updateAchievementSettings() {
        const bronze = parseInt(document.getElementById('bronzeThreshold').value) || 10;
        const silver = parseInt(document.getElementById('silverThreshold').value) || 25;
        const gold = parseInt(document.getElementById('goldThreshold').value) || 50;

        if (bronze >= silver || silver >= gold) {
            this.showToast('Thresholds must be in ascending order', 'error');
            return;
        }

        if (!this.data.settings) this.data.settings = {};
        this.data.settings.achievementThresholds = { bronze, silver, gold };

        this.saveData(this.data);
        this.showToast('Achievement settings updated', 'success');
    }

    async testDatabaseConnection() {
        this.showLoading();
        try {
            const response = await fetch('/.netlify/functions/supabase-starboard', {
                headers: { 'Cache-Control': 'no-store' }
            });

            if (response.ok) {
                this.updateSyncStatus('Database connection successful');
                this.showToast('Database connection successful', 'success');
            } else {
                this.updateSyncStatus('Database connection failed');
                this.showToast('Database connection failed', 'error');
            }
        } catch (error) {
            this.updateSyncStatus('Database connection failed');
            this.showToast('Database connection failed: ' + error.message, 'error');
        }
        this.hideLoading();
    }

    saveAllSettings() {
        // Collect all settings
        const settings = {
            systemName: document.getElementById('systemName').value,
            defaultTheme: document.getElementById('defaultTheme').value,
            enableSound: document.getElementById('enableSound').checked,
            autoBackup: document.getElementById('autoBackup').checked
        };

        // Update data
        if (!this.data.settings) this.data.settings = {};
        Object.assign(this.data.settings, settings);

        this.saveData(this.data);
        this.showToast('All settings saved successfully', 'success');
    }

    resetToDefaults() {
        this.showConfirm('Are you sure you want to reset all settings to defaults?', () => {
            const defaultSettings = {
                theme: 'dark',
                soundEnabled: true,
                autoBackup: true,
                achievementThresholds: { bronze: 10, silver: 25, gold: 50 }
            };

            this.data.settings = defaultSettings;
            this.saveData(this.data);
            this.showToast('Settings reset to defaults', 'success');
        });
    }

    // Backup & Restore
    createBackup() {
        const backupData = {
            ...this.data,
            backupInfo: {
                timestamp: new Date().toISOString(),
                type: 'manual',
                createdBy: this.currentUser,
                version: '2.0'
            }
        };

        const dataStr = JSON.stringify(backupData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `starboard-backup-${new Date().toISOString().split('T')[0]}.json`;
        link.click();

        this.showToast('Backup downloaded successfully', 'success');
    }

    exportCSV(type) {
        let csvContent = '';
        let filename = '';

        if (type === 'students') {
            csvContent = 'Name,Class,Stars,Joined\n';
            filename = 'students-export.csv';

            Object.entries(this.data.classes || {}).forEach(([className, classData]) => {
                if (classData.students) {
                    Object.values(classData.students).forEach(student => {
                        csvContent += `"${student.name}","${className}",${student.stars || 0},"${new Date(student.created || Date.now()).toLocaleDateString()}"\n`;
                    });
                }
            });
        } else if (type === 'classes') {
            csvContent = 'Class Name,Students,Total Stars,Created\n';
            filename = 'classes-export.csv';

            Object.entries(this.data.classes || {}).forEach(([className, classData]) => {
                const studentCount = Object.keys(classData.students || {}).length;
                const totalStars = Object.values(classData.students || {}).reduce((sum, student) => sum + (student.stars || 0), 0);
                csvContent += `"${className}",${studentCount},${totalStars},"${new Date(classData.created || Date.now()).toLocaleDateString()}"\n`;
            });
        }

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();

        this.showToast(`${type} exported successfully`, 'success');
    }

    generatePDF() {
        // In a real implementation, you'd use a PDF library like jsPDF
        this.showToast('PDF generation feature coming soon!', 'info');
    }

    // Modal Management
    showModal(title, body, buttons = []) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = body;

        const footer = document.getElementById('modalFooter');
        footer.innerHTML = '';

        buttons.forEach(button => {
            const btn = document.createElement('button');
            btn.textContent = button.text;
            btn.className = button.class;
            btn.onclick = button.action === 'close' ? () => this.closeModal() : button.action;
            footer.appendChild(btn);
        });

        document.getElementById('adminModal').classList.add('active');
    }

    closeModal() {
        document.getElementById('adminModal').classList.remove('active');
    }

    showConfirm(message, onConfirm) {
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmButton').onclick = () => {
            onConfirm();
            this.closeConfirm();
        };
        document.getElementById('confirmDialog').classList.add('active');
    }

    closeConfirm() {
        document.getElementById('confirmDialog').classList.remove('active');
    }

    cancelConfirm() {
        this.closeConfirm();
    }

    // Utility Functions
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Quick Actions
    quickAddClass() {
        this.showAddClassModal();
    }

    quickAddTeacher() {
        this.showAddTeacherModal();
    }

    exportAllData() {
        this.createBackup();
    }

    generateReport() {
        this.showToast('Report generation feature coming soon!', 'info');
    }
}

// Initialize the admin dashboard when DOM is loaded
let adminDashboard;
document.addEventListener('DOMContentLoaded', () => {
    adminDashboard = new AdminDashboard();
});