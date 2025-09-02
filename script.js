// StarBoard - Student Star Rating System
// Pure JavaScript implementation with IndexedDB-backed local database

class StarBoard {
    constructor() {
        this.currentUser = null;
        this.currentView = 'public';
        this.currentClass = null;
        this.searchQuery = '';
        this.leaderboardType = 'class';
        this.theme = localStorage.getItem('starboard_theme') || 'dark';
        this.soundEnabled = localStorage.getItem('starboard_sound') !== 'false';
        this.animationQueue = [];
        // In-memory cache for fast synchronous reads
        this.memoryCache = null;

        // Firebase / Firestore state
        this.firebaseConfig = null;
        this.firestore = null;
        
        this.initializeApp();
        this.bindEvents();
        this.applyTheme();
        this.loadFromURL();
        this.initializeAudio();
        this.startAnimationLoop();
    }

    // Initialize the application with enhanced data management
    async initializeApp() {
        // Initialize data storage
        await this.initializeDataStorage();
        
        this.loadClasses();
        this.updateUI();
        this.initializeParticleEffects();
        
        // Set up periodic data validation
        setInterval(() => {
            this.validateAndCleanupData();
        }, 300000); // Every 5 minutes
    }

    async initializeDataStorage() {
        // Try Netlify Function (shared cloud) first, then Firestore, else local IndexedDB
        try {
            const netlifyData = await this.tryLoadFromNetlify();
            if (netlifyData) {
                this.memoryCache = netlifyData;
                await this.dbInit();
                await this.dbSave(netlifyData);
                localStorage.setItem('starboard_data', JSON.stringify(netlifyData, null, 2));
                return;
            }
        } catch (_) {}

        // Priority: global Firebase config from HTML, else stored config
        await this.loadFirebaseConfig();
        if (window.STARBOARD_FIREBASE_CONFIG) {
            this.firebaseConfig = window.STARBOARD_FIREBASE_CONFIG;
        }
        if (this.firebaseConfig) {
            try {
                await this.initFirebase();
                const cloud = await this.loadDataFromFirestore();
                if (cloud) {
                    this.memoryCache = cloud;
                    // keep a local cache copy
                    await this.dbInit();
                    await this.dbSave(cloud);
                    localStorage.setItem('starboard_data', JSON.stringify(cloud, null, 2));
            return;
                }
            } catch (e) {
                console.warn('Firestore unavailable, falling back to local DB:', e);
            }
        }

        // Initialize local DB and prime cache
        await this.dbInit();
        const existing = await this.dbLoad();
        if (existing) {
            this.memoryCache = existing;
            } else {
                const defaultData = this.createDefaultData();
            this.memoryCache = defaultData;
            await this.dbSave(defaultData);
        }
    }

    // Local database-backed Data Storage System
    getData() {
        // Always serve from memory cache to keep synchronous UI working
        if (this.memoryCache) return this.memoryCache;
        const cached = this.getDataFromLocalStorage();
        this.memoryCache = cached;
        // Kick off async write to IndexedDB if needed
        this.dbSave(cached).catch(() => {});
        return cached;
    }

    // Save data to Firestore when available, otherwise IndexedDB; always refresh localStorage cache
    async saveData(data) {
        try {
            // Validate before saving
            if (!this.validateDataStructure(data)) {
                console.error('Invalid data structure, refusing to save');
                this.showToast('Invalid data structure', 'error');
                return false;
            }
            
            // Create timestamp and version info
            data.metadata = {
                lastModified: new Date().toISOString(),
                version: '2.0',
                backupCount: (data.metadata?.backupCount || 0) + 1
            };
            
            // Update memory cache immediately
            this.memoryCache = JSON.parse(JSON.stringify(data));
            // Try Netlify Function first, then Firestore, else local
            const pushed = await this.trySaveToNetlify(this.memoryCache).catch(() => false);
            if (!pushed && this.firestore) {
                try {
                    await this.saveDataToFirestore(this.memoryCache);
                } catch (e) {
                    console.warn('Failed to save to Firestore, saving locally instead:', e);
                    await this.dbSave(this.memoryCache);
                }
            } else if (!pushed) {
                await this.dbSave(this.memoryCache);
            }
            // Always update localStorage cache for quick reloads
            localStorage.setItem('starboard_data', JSON.stringify(this.memoryCache, null, 2));
            return true;
            
        } catch (error) {
            console.error('Error saving data:', error);
            this.showToast('Error saving data: ' + error.message, 'error');
            return false;
        }
    }

    // Netlify Function I/O
    async tryLoadFromNetlify() {
        try {
            const res = await fetch('/.netlify/functions/starboard', { headers: { 'Cache-Control': 'no-store' } });
            if (!res.ok) return null;
            const data = await res.json();
            if (this.validateDataStructure(data)) return data;
            return null;
        } catch (e) {
            return null;
        }
    }

    async trySaveToNetlify(data) {
        try {
            const res = await fetch('/.netlify/functions/starboard', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    // Local storage cache methods
    getDataFromLocalStorage() {
        try {
            const data = localStorage.getItem('starboard_data');
            if (!data) {
                return this.createDefaultData();
            }
            
            const parsedData = JSON.parse(data);
            
            // Validate data structure
            if (!this.validateDataStructure(parsedData)) {
                console.warn('Invalid data structure detected, resetting');
                return this.createDefaultData();
            }
            
            return parsedData;
        } catch (error) {
            console.error('Error loading from localStorage:', error);
            return this.createDefaultData();
        }
    }

    // IndexedDB implementation
    async dbInit() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('starboard_db', 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('kv')) {
                    db.createObjectStore('kv');
                }
            };
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async dbLoad() {
        return new Promise((resolve, reject) => {
            const openReq = indexedDB.open('starboard_db', 1);
            openReq.onsuccess = () => {
                const db = openReq.result;
                const tx = db.transaction('kv', 'readonly');
                const store = tx.objectStore('kv');
                const getReq = store.get('data');
                getReq.onsuccess = () => resolve(getReq.result || null);
                getReq.onerror = () => reject(getReq.error);
            };
            openReq.onerror = () => reject(openReq.error);
        });
    }

    // Firebase / Firestore integration
    async loadFirebaseConfig() {
        try {
            const raw = localStorage.getItem('starboard_firebase_config');
            if (raw) {
                this.firebaseConfig = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('No Firebase config found or invalid.');
        }
    }

    saveFirebaseConfig() {
        localStorage.setItem('starboard_firebase_config', JSON.stringify(this.firebaseConfig));
    }

    async initFirebase() {
        if (!this.firebaseConfig) throw new Error('Missing Firebase config');
        // Dynamically import Firebase SDK (works on Netlify/static hosting)
        const appMod = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js');
        const app = appMod.initializeApp(this.firebaseConfig);
        this._fsMod = fsMod;
        // Initialize Firestore with resilient transport settings
        try {
            this.firestore = fsMod.initializeFirestore(app, {
                experimentalAutoDetectLongPolling: true,
                useFetchStreams: false
            });
        } catch (e) {
            // Fallback for hosts that need explicit long polling
            this.firestore = fsMod.initializeFirestore(app, {
                experimentalForceLongPolling: true,
                useFetchStreams: false
            });
        }
    }

    async loadDataFromFirestore() {
        if (!this.firestore) return null;
        const { doc, getDoc } = this._fsMod;
        const ref = doc(this.firestore, 'starboard', 'data');
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const data = snap.data();
        // Validate structure before using
        if (this.validateDataStructure(data)) return data;
        return null;
    }

    async saveDataToFirestore(data) {
        if (!this.firestore) return false;
        const { doc, setDoc } = this._fsMod;
        const ref = doc(this.firestore, 'starboard', 'data');
        await setDoc(ref, data, { merge: false });
        return true;
    }

    showFirebaseSetup() {
        const body = `
            <div class="form-group">
                <label>apiKey</label>
                <input type="text" id="fb-apiKey" class="glass-input" placeholder="AIza...">
            </div>
            <div class="form-group">
                <label>authDomain</label>
                <input type="text" id="fb-authDomain" class="glass-input" placeholder="your-app.firebaseapp.com">
            </div>
            <div class="form-group">
                <label>projectId</label>
                <input type="text" id="fb-projectId" class="glass-input" placeholder="your-project-id">
            </div>
            <p class="text-muted">Optional advanced fields (leave blank if unsure):</p>
            <div class="form-group">
                <label>storageBucket</label>
                <input type="text" id="fb-storageBucket" class="glass-input" placeholder="your-project-id.appspot.com">
            </div>
            <div class="form-group">
                <label>messagingSenderId</label>
                <input type="text" id="fb-messagingSenderId" class="glass-input" placeholder="1234567890">
            </div>
            <div class="form-group">
                <label>appId</label>
                <input type="text" id="fb-appId" class="glass-input" placeholder="1:123:web:abc">
            </div>
        `;
        this.showModal('Cloud Database Setup (Firebase)', body, [
            { text: 'Skip (Local Only)', class: 'btn-secondary', action: () => this.closeModal() },
            { text: 'Save', class: 'btn-primary', action: async () => {
                const cfg = {
                    apiKey: document.getElementById('fb-apiKey').value.trim(),
                    authDomain: document.getElementById('fb-authDomain').value.trim(),
                    projectId: document.getElementById('fb-projectId').value.trim()
                };
                const storageBucket = document.getElementById('fb-storageBucket').value.trim();
                const messagingSenderId = document.getElementById('fb-messagingSenderId').value.trim();
                const appId = document.getElementById('fb-appId').value.trim();
                if (storageBucket) cfg.storageBucket = storageBucket;
                if (messagingSenderId) cfg.messagingSenderId = messagingSenderId;
                if (appId) cfg.appId = appId;
                if (!cfg.apiKey || !cfg.authDomain || !cfg.projectId) {
                    this.showToast('Please fill required fields', 'error');
                    return;
                }
                this.firebaseConfig = cfg;
                this.saveFirebaseConfig();
                try {
                    await this.initFirebase();
                    // on first-time setup, if no cloud doc, push current local data
                    const data = this.getData();
                    await this.saveDataToFirestore(data);
                    this.showToast('Cloud DB configured!', 'success');
                    this.closeModal();
                } catch (e) {
                    this.showToast('Failed to init Firebase: ' + e.message, 'error');
                }
            }}
        ]);
    }

    async dbSave(data) {
        return new Promise((resolve, reject) => {
            const openReq = indexedDB.open('starboard_db', 1);
            openReq.onsuccess = () => {
                const db = openReq.result;
                const tx = db.transaction('kv', 'readwrite');
                const store = tx.objectStore('kv');
                const putReq = store.put(data, 'data');
                putReq.onsuccess = () => resolve(true);
                putReq.onerror = () => reject(putReq.error);
            };
            openReq.onerror = () => reject(openReq.error);
        });
    }

    // Bind event listeners
    bindEvents() {
        // Navigation
        document.getElementById('publicViewBtn').addEventListener('click', () => this.switchView('public'));
        document.getElementById('teacherPortalBtn').addEventListener('click', () => this.switchView('teacher'));
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());

        // Public view events
        document.getElementById('classSelect').addEventListener('change', (e) => this.selectClass(e.target.value));
        document.getElementById('leaderboardType').addEventListener('change', (e) => this.changeLeaderboardType(e.target.value));
        document.getElementById('studentSearch').addEventListener('input', (e) => this.searchStudents(e.target.value));
        document.getElementById('shareClassBtn').addEventListener('click', () => this.shareClass());

        // Teacher login
        document.getElementById('teacherLoginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        // Class management
        document.getElementById('createClassBtn').addEventListener('click', () => this.createClass());
        document.getElementById('teacherClassSelect').addEventListener('change', (e) => this.selectTeacherClass(e.target.value));
        document.getElementById('addStudentBtn').addEventListener('click', () => this.addStudent());
        document.getElementById('renameClassBtn').addEventListener('click', () => this.renameClass());
        document.getElementById('deleteClassBtn').addEventListener('click', () => this.deleteClass());

        // Data management
        document.getElementById('exportDataBtn').addEventListener('click', () => this.exportData());
        document.getElementById('importDataBtn').addEventListener('click', () => this.importData());
        document.getElementById('importFileInput').addEventListener('change', (e) => this.handleFileImport(e));

        // Modal events
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') this.closeModal();
        });
        document.querySelector('.modal-close').addEventListener('click', () => this.closeModal());

        // Enter key handlers
        document.getElementById('newClassName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createClass();
        });
        document.getElementById('newStudentName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addStudent();
        });
    }

    // Switch between views
    switchView(view) {
        this.currentView = view;
        
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(view === 'public' ? 'publicViewBtn' : 'teacherPortalBtn').classList.add('active');
        
        // Update view visibility
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(view === 'public' ? 'publicView' : 'teacherPortal').classList.add('active');
        
        if (view === 'teacher' && !this.currentUser) {
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('teacherDashboard').classList.remove('active');
        }
        
        this.updateURL();
    }

    // Theme management
    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        localStorage.setItem('starboard_theme', this.theme);
        
        const themeIcon = document.querySelector('#themeToggle i');
        themeIcon.className = this.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    // URL management for deep linking
    updateURL() {
        const params = new URLSearchParams();
        if (this.currentView === 'teacher') params.set('view', 'teacher');
        if (this.currentClass && this.currentView === 'public') params.set('class', this.currentClass);
        
        const url = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
        window.history.pushState({}, '', url);
    }

    loadFromURL() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('view') === 'teacher') {
            this.switchView('teacher');
        }
        if (params.get('class')) {
            this.selectClass(params.get('class'));
        }
    }

    // Class management
    loadClasses() {
        const data = this.getData();
        const classSelect = document.getElementById('classSelect');
        const teacherClassSelect = document.getElementById('teacherClassSelect');
        
        classSelect.innerHTML = '<option value="">Select a class</option>';
        teacherClassSelect.innerHTML = '<option value="">Select a class to manage</option>';
        
        Object.keys(data.classes).forEach(className => {
            const option1 = new Option(className, className);
            const option2 = new Option(className, className);
            classSelect.appendChild(option1);
            teacherClassSelect.appendChild(option2);
        });
    }

    createClass() {
        const className = document.getElementById('newClassName').value.trim();
        if (!className) {
            this.showToast('Please enter a class name', 'error');
            return;
        }

        const data = this.getData();
        if (data.classes[className]) {
            this.showToast('Class already exists', 'error');
            return;
        }

        data.classes[className] = {
            students: {},
            created: new Date().toISOString()
        };

        if (this.saveData(data)) {
            document.getElementById('newClassName').value = '';
            this.loadClasses();
            this.showToast('Class created successfully', 'success');
        }
    }

    selectClass(className) {
        this.currentClass = className;
        this.updateLeaderboard();
        this.updateURL();
        
        // Show/hide share button
        const shareBtn = document.getElementById('shareClassBtn');
        shareBtn.style.display = className ? 'inline-flex' : 'none';
    }

    selectTeacherClass(className) {
        this.currentClass = className;
        const managementSection = document.getElementById('studentManagement');
        const statisticsSection = document.getElementById('classStatistics');
        
        if (className) {
            managementSection.style.display = 'block';
            statisticsSection.style.display = 'block';
            document.getElementById('currentClassName').textContent = className;
            document.getElementById('statsClassName').textContent = className;
            this.loadStudents();
            this.updateClassStatistics();
        } else {
            managementSection.style.display = 'none';
            statisticsSection.style.display = 'none';
        }
    }

    renameClass() {
        if (!this.currentClass) return;
        
        this.showModal('Rename Class', 
            `<input type="text" id="newClassNameInput" value="${this.currentClass}" class="glass-input" style="width: 100%; padding: 12px; margin-bottom: 15px;">`,
            [
                { text: 'Cancel', class: 'btn-secondary', action: 'close' },
                { text: 'Rename', class: 'btn-primary', action: () => {
                    const newName = document.getElementById('newClassNameInput').value.trim();
                    if (newName && newName !== this.currentClass) {
                        const data = this.getData();
                        data.classes[newName] = data.classes[this.currentClass];
                        delete data.classes[this.currentClass];
                        
                        if (this.saveData(data)) {
                            this.currentClass = newName;
                            this.loadClasses();
                            this.selectTeacherClass(newName);
                            document.getElementById('teacherClassSelect').value = newName;
                            this.showToast('Class renamed successfully', 'success');
                            this.closeModal();
                        }
                    }
                }}
            ]
        );
    }

    deleteClass() {
        if (!this.currentClass) return;
        
        this.showModal('Delete Class', 
            `<p>Are you sure you want to delete the class "<strong>${this.currentClass}</strong>"?</p><p class="text-muted">This action cannot be undone and will remove all students and their stars.</p>`,
            [
                { text: 'Cancel', class: 'btn-secondary', action: 'close' },
                { text: 'Delete', class: 'btn-danger', action: () => {
                    const data = this.getData();
                    delete data.classes[this.currentClass];
                    
                    if (this.saveData(data)) {
                        this.loadClasses();
                        this.selectTeacherClass('');
                        document.getElementById('teacherClassSelect').value = '';
                        this.showToast('Class deleted successfully', 'success');
                        this.closeModal();
                    }
                }}
            ]
        );
    }

    // Student management
    addStudent() {
        const studentName = document.getElementById('newStudentName').value.trim();
        if (!studentName) {
            this.showToast('Please enter a student name', 'error');
            return;
        }

        if (!this.currentClass) {
            this.showToast('Please select a class first', 'error');
            return;
        }

        const data = this.getData();
        const studentId = this.generateId();
        
        if (!data.classes[this.currentClass]) {
            data.classes[this.currentClass] = { students: {} };
        }

        data.classes[this.currentClass].students[studentId] = {
            name: studentName,
            stars: 0,
            created: new Date().toISOString()
        };

        if (this.saveData(data)) {
            document.getElementById('newStudentName').value = '';
            this.loadStudents();
            this.showToast('Student added successfully', 'success');
        }
    }

    loadStudents() {
        const data = this.getData();
        const studentList = document.getElementById('studentList');
        
        if (!data.classes[this.currentClass] || !data.classes[this.currentClass].students) {
            studentList.innerHTML = '<div class="empty-state"><p>No students in this class yet.</p></div>';
            return;
        }

        const students = data.classes[this.currentClass].students;
        studentList.innerHTML = '';

        Object.entries(students).forEach(([studentId, student]) => {
            const studentItem = document.createElement('div');
            studentItem.className = 'student-item';
            studentItem.innerHTML = `
                <div class="student-details">
                    <div class="student-name">${student.name}</div>
                    <div class="student-stars star-counter">
                        <i class="fas fa-star"></i>
                        ${student.stars} stars
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${Math.min((student.stars / 50) * 100, 100)}%"></div>
                    </div>
                    <div class="achievement-badges">
                        ${this.getAchievementBadges(student.stars)}
                    </div>
                </div>
                <div class="student-controls">
                    <div class="star-controls">
                        <button class="star-btn add" onclick="starBoard.modifyStars('${studentId}', 1)">+1</button>
                        <button class="star-btn add" onclick="starBoard.modifyStars('${studentId}', 5)">+5</button>
                        <button class="star-btn remove" onclick="starBoard.modifyStars('${studentId}', -1)">-1</button>
                    </div>
                    <button class="btn-secondary" onclick="starBoard.editStudent('${studentId}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-danger" onclick="starBoard.removeStudent('${studentId}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            studentList.appendChild(studentItem);
        });
    }

    modifyStars(studentId, amount) {
        const data = this.getData();
        const student = data.classes[this.currentClass].students[studentId];
        
        if (!student) return;

        const oldStars = student.stars;
        student.stars = Math.max(0, student.stars + amount);
        
        if (this.saveData(data)) {
            this.loadStudents();
            this.updateLeaderboard();
            this.updateClassStatistics();
            
            // Create floating star effect
            this.createFloatingStarEffect(amount);
            
            // Play star sound
            this.playSound(amount > 0 ? 'star-add' : 'star-remove');
            
            // Check for new achievements
            this.checkAchievements(oldStars, student.stars, student.name);
            
            const action = amount > 0 ? 'added' : 'removed';
            this.showToast(`${Math.abs(amount)} star${Math.abs(amount) !== 1 ? 's' : ''} ${action} for ${student.name}`, 'success');
        }
    }

    editStudent(studentId) {
        const data = this.getData();
        const student = data.classes[this.currentClass].students[studentId];
        
        if (!student) return;

        this.showModal('Edit Student', 
            `<input type="text" id="editStudentNameInput" value="${student.name}" class="glass-input" style="width: 100%; padding: 12px; margin-bottom: 15px;">`,
            [
                { text: 'Cancel', class: 'btn-secondary', action: 'close' },
                { text: 'Save', class: 'btn-primary', action: () => {
                    const newName = document.getElementById('editStudentNameInput').value.trim();
                    if (newName && newName !== student.name) {
                        student.name = newName;
                        if (this.saveData(data)) {
                            this.loadStudents();
                            this.updateLeaderboard();
                            this.showToast('Student updated successfully', 'success');
                            this.closeModal();
                        }
                    }
                }}
            ]
        );
    }

    removeStudent(studentId) {
        const data = this.getData();
        const student = data.classes[this.currentClass].students[studentId];
        
        if (!student) return;

        this.showModal('Remove Student', 
            `<p>Are you sure you want to remove "<strong>${student.name}</strong>" from the class?</p><p class="text-muted">This will permanently delete their stars and progress.</p>`,
            [
                { text: 'Cancel', class: 'btn-secondary', action: 'close' },
                { text: 'Remove', class: 'btn-danger', action: () => {
                    delete data.classes[this.currentClass].students[studentId];
                    if (this.saveData(data)) {
                        this.loadStudents();
                        this.updateLeaderboard();
                        this.showToast('Student removed successfully', 'success');
                        this.closeModal();
                    }
                }}
            ]
        );
    }

    // Leaderboard management
    changeLeaderboardType(type) {
        this.leaderboardType = type;
        this.updateLeaderboard();
    }

    updateLeaderboard() {
        const leaderboard = document.getElementById('leaderboard');
        const data = this.getData();

        let students = [];

        if (this.leaderboardType === 'global') {
            // Global leaderboard - all students from all classes
            Object.entries(data.classes).forEach(([className, classData]) => {
                if (classData.students) {
                    Object.entries(classData.students).forEach(([studentId, student]) => {
                        students.push({
                            ...student,
                            className: className,
                            id: studentId
                        });
                    });
                }
            });
        } else {
            // Class-specific leaderboard
            if (!this.currentClass || !data.classes[this.currentClass] || !data.classes[this.currentClass].students) {
                leaderboard.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-star"></i>
                        <h3>${this.currentClass ? 'No Students Yet' : 'Select a Class'}</h3>
                        <p>${this.currentClass ? 'This class doesn\'t have any students yet.' : 'Choose a class to view the leaderboard'}</p>
                    </div>
                `;
                return;
            }

            Object.entries(data.classes[this.currentClass].students).forEach(([studentId, student]) => {
                students.push({
                    ...student,
                    className: this.currentClass,
                    id: studentId
                });
            });
        }

        // Filter by search query
        if (this.searchQuery) {
            students = students.filter(student => 
                student.name.toLowerCase().includes(this.searchQuery.toLowerCase())
            );
        }

        // Sort by stars (descending)
        students.sort((a, b) => b.stars - a.stars);

        if (students.length === 0) {
            leaderboard.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <h3>No Results</h3>
                    <p>No students found matching "${this.searchQuery}"</p>
                </div>
            `;
            return;
        }

        // Generate leaderboard HTML
        leaderboard.innerHTML = students.map((student, index) => {
            const rank = index + 1;
            let rankClass = '';
            if (rank === 1) rankClass = 'top-1';
            else if (rank === 2) rankClass = 'top-2';
            else if (rank === 3) rankClass = 'top-3';

            return `
                <div class="student-card">
                    <div class="student-rank ${rankClass}">#${rank}</div>
                    <div class="student-info">
                        <div class="student-name">${student.name}</div>
                        ${this.leaderboardType === 'global' ? `<div class="student-class">${student.className}</div>` : ''}
                    </div>
                    <div class="student-stars star-counter">
                        <i class="fas fa-star"></i>
                        ${student.stars}
                    </div>
                    <div class="achievement-badges">
                        ${this.getAchievementBadges(student.stars)}
                    </div>
                </div>
            `;
        }).join('');
    }

    searchStudents(query) {
        this.searchQuery = query;
        this.updateLeaderboard();
    }

    // Achievement system
    getAchievementBadges(stars) {
        const badges = [];
        if (stars >= 50) badges.push('<div class="achievement-badge gold">50</div>');
        else if (stars >= 25) badges.push('<div class="achievement-badge silver">25</div>');
        if (stars >= 10) badges.push('<div class="achievement-badge bronze">10</div>');
        return badges.join('');
    }

    checkAchievements(oldStars, newStars, studentName) {
        const milestones = [10, 25, 50];
        milestones.forEach(milestone => {
            if (oldStars < milestone && newStars >= milestone) {
                this.showAchievementNotification(studentName, milestone);
            }
        });
    }

    showAchievementNotification(studentName, milestone) {
        const badgeType = milestone === 50 ? 'gold' : milestone === 25 ? 'silver' : 'bronze';
        this.showToast(`🎉 ${studentName} earned the ${milestone}⭐ achievement!`, 'success', 5000);
        
        // Play achievement sound
        this.playSound('achievement');
        
        // Create celebration effect
        this.createCelebrationEffect();
        
        // Show achievement modal
        this.showAchievementModal(studentName, milestone, badgeType);
    }

    // Authentication
    handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('teacherUsername').value;
        const password = document.getElementById('teacherPassword').value;

        const data = this.getData();
        if (data.teachers[username] && data.teachers[username] === password) {
            this.currentUser = username;
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('teacherDashboard').classList.add('active');
            this.loadClasses();
            this.showToast('Login successful', 'success');
        } else {
            this.showToast('Invalid credentials', 'error');
        }
    }

    logout() {
        this.currentUser = null;
        this.currentClass = null;
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('teacherDashboard').classList.remove('active');
        document.getElementById('teacherLoginForm').reset();
        document.getElementById('studentManagement').style.display = 'none';
        this.showToast('Logged out successfully', 'info');
    }

    // Data import/export
    exportData() {
        const data = this.getData();
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `starboard-data-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        this.showToast('Data exported successfully', 'success');
    }

    importData() {
        document.getElementById('importFileInput').click();
    }

    handleFileImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                // Validate data structure
                if (!importedData.classes || typeof importedData.classes !== 'object') {
                    throw new Error('Invalid data format');
                }

                // Confirm import
                this.showModal('Import Data', 
                    `<p>This will replace all current data with the imported data.</p><p class="text-muted">Found ${Object.keys(importedData.classes).length} classes to import.</p><p><strong>This action cannot be undone.</strong></p>`,
                    [
                        { text: 'Cancel', class: 'btn-secondary', action: 'close' },
                        { text: 'Import', class: 'btn-primary', action: () => {
                            if (this.saveData(importedData)) {
                                this.loadClasses();
                                this.updateLeaderboard();
                                this.showToast('Data imported successfully', 'success');
                                this.closeModal();
                            }
                        }}
                    ]
                );
                
            } catch (error) {
                this.showToast('Invalid file format', 'error');
            }
        };
        reader.readAsText(file);
        
        // Reset file input
        e.target.value = '';
    }

    // Deep linking
    shareClass() {
        if (!this.currentClass) return;
        
        const url = `${window.location.origin}${window.location.pathname}?class=${encodeURIComponent(this.currentClass)}`;
        
        if (navigator.share) {
            navigator.share({
                title: `${this.currentClass} - StarBoard Leaderboard`,
                text: `Check out the ${this.currentClass} leaderboard on StarBoard!`,
                url: url
            });
        } else {
            navigator.clipboard.writeText(url).then(() => {
                this.showToast('Class link copied to clipboard', 'success');
            }).catch(() => {
                this.showModal('Share Class', 
                    `<p>Copy this link to share the class leaderboard:</p><input type="text" value="${url}" readonly style="width: 100%; padding: 10px; margin-top: 10px;" onclick="this.select()">`,
                    [{ text: 'Close', class: 'btn-primary', action: 'close' }]
                );
            });
        }
    }

    // UI utilities
    updateUI() {
        // Update any UI elements that need refreshing
        this.loadClasses();
        if (this.currentView === 'public') {
            this.updateLeaderboard();
        }

        // Prompt for Firebase on first load if no cloud configured
        if (!this.firebaseConfig && !localStorage.getItem('starboard_firebase_prompted')) {
            localStorage.setItem('starboard_firebase_prompted', 'true');
            this.showFirebaseSetup();
        }
    }

    showModal(title, body, buttons) {
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
        
        document.getElementById('modalOverlay').classList.add('active');
    }

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('active');
    }

    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        document.getElementById('toastContainer').appendChild(toast);
        
        // Animate in
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Auto remove
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Class Statistics
    updateClassStatistics() {
        if (!this.currentClass) return;
        
        const data = this.getData();
        const classData = data.classes[this.currentClass];
        
        if (!classData || !classData.students) return;
        
        const students = Object.values(classData.students);
        const totalStudents = students.length;
        const totalStars = students.reduce((sum, student) => sum + student.stars, 0);
        const averageStars = totalStudents > 0 ? (totalStars / totalStudents).toFixed(1) : 0;
        const topPerformer = totalStudents > 0 ? 
            students.reduce((top, student) => student.stars > top.stars ? student : top, students[0]) : null;
        
        // Update UI with animation
        this.animateStatValue('totalStudents', totalStudents);
        this.animateStatValue('totalStars', totalStars);
        this.animateStatValue('averageStars', averageStars);
        
        const topPerformerElement = document.getElementById('topPerformer');
        if (topPerformer) {
            topPerformerElement.textContent = topPerformer.name;
            topPerformerElement.style.color = 'var(--accent-primary)';
        } else {
            topPerformerElement.textContent = '-';
            topPerformerElement.style.color = 'var(--text-muted)';
        }
    }

    animateStatValue(elementId, targetValue) {
        const element = document.getElementById(elementId);
        const currentValue = parseInt(element.textContent) || 0;
        const increment = targetValue > currentValue ? 1 : -1;
        const steps = Math.abs(targetValue - currentValue);
        let step = 0;
        
        const animate = () => {
            if (step < steps) {
                element.textContent = currentValue + (increment * step);
                step++;
                setTimeout(animate, 30);
            } else {
                element.textContent = targetValue;
            }
        };
        
        if (steps > 0) {
            animate();
        }
    }

    // Data Structure Management Functions
    createDefaultData() {
        return {
            classes: {},
            teachers: {
                'teacher': 'starboard' // username: password
            },
            settings: {
                theme: 'dark',
                soundEnabled: true,
                autoBackup: true
            },
            metadata: {
                version: '2.0',
                created: new Date().toISOString(),
                lastModified: new Date().toISOString(),
                backupCount: 0
            }
        };
    }

    validateDataStructure(data) {
        if (!data || typeof data !== 'object') return false;
        
        // Check required top-level properties
        const requiredProps = ['classes', 'teachers', 'settings'];
        for (const prop of requiredProps) {
            if (!data.hasOwnProperty(prop) || typeof data[prop] !== 'object') {
                console.error(`Missing or invalid property: ${prop}`);
                return false;
            }
        }

        // Validate classes structure
        if (data.classes) {
            for (const [className, classData] of Object.entries(data.classes)) {
                if (!classData.students || typeof classData.students !== 'object') {
                    console.error(`Invalid class structure for: ${className}`);
                    return false;
                }
                
                // Validate student structure
                for (const [studentId, student] of Object.entries(classData.students)) {
                    if (!student.name || typeof student.stars !== 'number' || student.stars < 0) {
                        console.error(`Invalid student data for: ${studentId} in class ${className}`);
                        return false;
                    }
                }
            }
        }

        // Validate teachers structure
        if (data.teachers) {
            for (const [username, password] of Object.entries(data.teachers)) {
                if (typeof username !== 'string' || typeof password !== 'string') {
                    console.error(`Invalid teacher credentials for: ${username}`);
                    return false;
                }
            }
        }

        return true;
    }

    migrateData(oldData) {
        console.log('Migrating data to new structure...');
        
        const newData = this.createDefaultData();
        
        // Migrate classes if they exist
        if (oldData.classes && typeof oldData.classes === 'object') {
            newData.classes = oldData.classes;
        }
        
        // Migrate teachers if they exist
        if (oldData.teachers && typeof oldData.teachers === 'object') {
            newData.teachers = { ...newData.teachers, ...oldData.teachers };
        }
        
        // Migrate settings if they exist
        if (oldData.settings && typeof oldData.settings === 'object') {
            newData.settings = { ...newData.settings, ...oldData.settings };
        }
        
        // Save migrated data
        if (this.saveData(newData)) {
            this.showToast('Data successfully migrated to new format', 'success');
        }
    }

    createBackup(data) {
        try {
            const backupKey = `starboard_backup_${Date.now()}`;
            const backupData = {
                ...data,
                backupInfo: {
                    originalTimestamp: data.metadata?.lastModified || new Date().toISOString(),
                    backupTimestamp: new Date().toISOString(),
                    type: 'automatic'
                }
            };
            
            localStorage.setItem(backupKey, JSON.stringify(backupData));
            
            // Clean up old backups (keep only last 5)
            this.cleanupOldBackups();
            
            console.log(`Backup created: ${backupKey}`);
            return true;
        } catch (error) {
            console.error('Failed to create backup:', error);
            return false;
        }
    }

    createCorruptedDataBackup(corruptedData) {
        try {
            const backupKey = `starboard_corrupted_${Date.now()}`;
            localStorage.setItem(backupKey, corruptedData);
            console.log(`Corrupted data backed up: ${backupKey}`);
        } catch (error) {
            console.error('Failed to backup corrupted data:', error);
        }
    }

    cleanupOldBackups() {
        try {
            const backupKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('starboard_backup_')) {
                    backupKeys.push(key);
                }
            }
            
            // Sort by timestamp (newest first)
            backupKeys.sort().reverse();
            
            // Remove old backups (keep only 5 most recent)
            for (let i = 5; i < backupKeys.length; i++) {
                localStorage.removeItem(backupKeys[i]);
                console.log(`Removed old backup: ${backupKeys[i]}`);
            }
        } catch (error) {
            console.error('Error cleaning up backups:', error);
        }
    }

    async validateAndCleanupData() {
        const data = this.getData();
        let hasChanges = false;
        
        // Clean up any invalid student data
        Object.keys(data.classes).forEach(className => {
            const classData = data.classes[className];
            if (classData.students) {
                Object.keys(classData.students).forEach(studentId => {
                    const student = classData.students[studentId];
                    if (typeof student.stars !== 'number' || student.stars < 0) {
                        student.stars = 0;
                        hasChanges = true;
                    }
                    if (!student.name || typeof student.name !== 'string') {
                        delete classData.students[studentId];
                        hasChanges = true;
                    }
                });
            }
        });
        
        if (hasChanges) {
            await this.saveData(data);
            console.log('Data cleanup performed');
        }
    }

    // Manual backup and restore functions
    createManualBackup() {
        const data = this.getData();
        const backupKey = `starboard_manual_${Date.now()}`;
        const backupData = {
            ...data,
            backupInfo: {
                timestamp: new Date().toISOString(),
                type: 'manual',
                description: 'Manual backup created by user'
            }
        };
        
        try {
            localStorage.setItem(backupKey, JSON.stringify(backupData));
            this.showToast('Manual backup created successfully', 'success');
            return backupKey;
        } catch (error) {
            this.showToast('Failed to create manual backup: ' + error.message, 'error');
            return null;
        }
    }

    listBackups() {
        const backups = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('starboard_backup_') || key.startsWith('starboard_manual_'))) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    backups.push({
                        key: key,
                        timestamp: data.backupInfo?.timestamp || 'Unknown',
                        type: data.backupInfo?.type || 'unknown',
                        size: JSON.stringify(data).length
                    });
                } catch (error) {
                    console.error(`Invalid backup data for key: ${key}`);
                }
            }
        }
        return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // Remove GitHub-related functionality

    // Enhanced Audio System
    initializeAudio() {
        this.audioContext = null;
        this.sounds = {
            'star-add': { frequency: 800, duration: 0.2, type: 'sine' },
            'star-remove': { frequency: 400, duration: 0.3, type: 'square' },
            'achievement': { frequency: 1000, duration: 0.5, type: 'triangle' },
            'button-click': { frequency: 600, duration: 0.1, type: 'sine' }
        };
        
        // Add sound toggle button
        this.addSoundToggle();
    }

    addSoundToggle() {
        const navButtons = document.querySelector('.nav-buttons');
        const soundBtn = document.createElement('button');
        soundBtn.className = 'theme-toggle';
        soundBtn.innerHTML = `<i class="fas fa-volume-${this.soundEnabled ? 'up' : 'mute'}"></i>`;
        soundBtn.onclick = () => this.toggleSound();
        navButtons.appendChild(soundBtn);
    }

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        localStorage.setItem('starboard_sound', this.soundEnabled);
        const icon = document.querySelector('.nav-buttons button:last-child i');
        icon.className = `fas fa-volume-${this.soundEnabled ? 'up' : 'mute'}`;
        this.showToast(`Sound ${this.soundEnabled ? 'enabled' : 'disabled'}`, 'info');
    }

    playSound(soundType) {
        if (!this.soundEnabled || !this.sounds[soundType]) return;
        
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const sound = this.sounds[soundType];
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(sound.frequency, this.audioContext.currentTime);
            oscillator.type = sound.type;
            
            gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + sound.duration);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + sound.duration);
        } catch (error) {
            console.log('Audio not supported:', error);
        }
    }

    // Enhanced Visual Effects
    initializeParticleEffects() {
        // Add dynamic particle generation
        setInterval(() => {
            this.createRandomParticle();
        }, 3000);
    }

    createRandomParticle() {
        const starfield = document.querySelector('.starfield');
        const particle = document.createElement('div');
        particle.style.position = 'absolute';
        particle.style.width = '2px';
        particle.style.height = '2px';
        particle.style.background = `hsl(${Math.random() * 360}, 80%, 80%)`;
        particle.style.borderRadius = '50%';
        particle.style.left = Math.random() * window.innerWidth + 'px';
        particle.style.top = window.innerHeight + 'px';
        particle.style.boxShadow = `0 0 ${Math.random() * 10 + 5}px currentColor`;
        particle.style.animation = `float-particles ${Math.random() * 20 + 30}s linear forwards`;
        
        starfield.appendChild(particle);
        
        setTimeout(() => {
            if (particle.parentNode) {
                particle.parentNode.removeChild(particle);
            }
        }, 50000);
    }

    createFloatingStarEffect(amount) {
        const button = event ? event.target : null;
        if (!button) return;
        
        const rect = button.getBoundingClientRect();
        for (let i = 0; i < Math.abs(amount); i++) {
            setTimeout(() => {
                const star = document.createElement('div');
                star.className = 'floating-star';
                star.innerHTML = amount > 0 ? '★' : '☆';
                star.style.left = (rect.left + Math.random() * rect.width) + 'px';
                star.style.top = (rect.top + Math.random() * rect.height) + 'px';
                star.style.color = amount > 0 ? '#ffd700' : '#ff6b6b';
                
                document.body.appendChild(star);
                
                setTimeout(() => {
                    if (star.parentNode) {
                        star.parentNode.removeChild(star);
                    }
                }, 2000);
            }, i * 100);
        }
    }

    createCelebrationEffect() {
        const container = document.getElementById('celebrationContainer');
        const colors = ['#00d4ff', '#ff6b6b', '#51cf66', '#ffd43b', '#ffd700'];
        
        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * window.innerWidth + 'px';
                confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDelay = Math.random() * 2 + 's';
                
                container.appendChild(confetti);
                
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, 3000);
            }, i * 50);
        }
    }

    showAchievementModal(studentName, milestone, badgeType) {
        const badgeColor = badgeType === 'gold' ? '#ffd700' : badgeType === 'silver' ? '#c0c0c0' : '#cd7f32';
        this.showModal('🎉 Achievement Unlocked! 🎉', 
            `
            <div class="text-center">
                <div class="achievement-badge ${badgeType}" style="width: 80px; height: 80px; font-size: 24px; margin: 20px auto; display: flex; align-items: center; justify-content: center;">
                    ${milestone}
                </div>
                <h3 style="color: ${badgeColor}; margin: 20px 0;">${studentName}</h3>
                <p>has earned the <strong>${milestone} Star Achievement</strong>!</p>
                <p class="text-muted">Keep up the excellent work!</p>
            </div>
            `,
            [
                { text: 'Awesome!', class: 'btn-primary', action: 'close' }
            ]
        );
        
        // Add special class for achievement modal styling
        setTimeout(() => {
            document.querySelector('.modal').classList.add('achievement-modal');
        }, 100);
    }

    startAnimationLoop() {
        // Enhanced button click animations
        document.addEventListener('click', (e) => {
            if (e.target.matches('button') || e.target.closest('button')) {
                this.playSound('button-click');
                const button = e.target.closest('button') || e.target;
                button.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    button.style.transform = '';
                }, 150);
            }
        });

        // Add glassmorphism animation to panels
        const panels = document.querySelectorAll('.glass-panel');
        panels.forEach(panel => {
            panel.addEventListener('mouseenter', () => {
                panel.classList.add('animated');
            });
            panel.addEventListener('mouseleave', () => {
                panel.classList.remove('animated');
            });
        });

        // Add ripple effect to buttons
        setTimeout(() => {
            this.addEnhancedInteractions();
        }, 1000);
    }

    addEnhancedInteractions() {
        // Add ripple effect to buttons
        document.querySelectorAll('button').forEach(button => {
            button.addEventListener('click', (e) => {
                const ripple = document.createElement('div');
                ripple.style.position = 'absolute';
                ripple.style.borderRadius = '50%';
                ripple.style.background = 'rgba(255, 255, 255, 0.3)';
                ripple.style.transform = 'scale(0)';
                ripple.style.animation = 'ripple 0.6s linear';
                ripple.style.pointerEvents = 'none';
                
                const rect = button.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
                ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
                
                button.appendChild(ripple);
                
                setTimeout(() => {
                    if (ripple.parentNode) {
                        ripple.parentNode.removeChild(ripple);
                    }
                }, 600);
            });
        });
    }
}

// Add CSS for ripple effect and enhanced animations
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
    
    button {
        position: relative;
        overflow: hidden;
    }
`;
document.head.appendChild(style);

// Initialize the application
let starBoard;
document.addEventListener('DOMContentLoaded', () => {
    starBoard = new StarBoard();
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
    starBoard.loadFromURL();
});
