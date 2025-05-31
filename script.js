import { collection, addDoc, getDocs, doc, setDoc, getDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const DataManager = {
    db: null,
    auth: null,
    currentUser: null,
    exchangeRates: { KGS: 1, USD: 89.5, CNY: 12.5, RUB: 0.95 },
    TAX_RATE: 0.10,
    SOCIAL_RATE: 0.2725,
    VAT_RATE: 0.12,
    clothingTypes: {
        Футболка: ['Рукав', 'Перед', 'Спинка'],
        Брюки: ['Штанина', 'Пояс', 'Карман'],
        Платье: ['Лиф', 'Юбка', 'Рукава']
    },

    // Инициализация Firestore и Authentication
    init(db, auth) {
        this.db = db;
        this.auth = auth;
        this.loadClothingTypes();
    },

    // Загрузка clothingTypes из Firestore
    async loadClothingTypes() {
        try {
            const docRef = doc(this.db, 'global', 'clothingTypes');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                this.clothingTypes = docSnap.data().types;
            } else {
                await setDoc(docRef, { types: this.clothingTypes });
            }
        } catch (e) {
            console.error('Ошибка загрузки clothingTypes:', e);
            UIManager.showNotification(Translations[UIManager.currentLanguage].clothing_type_error, 'error');
        }
    },

    // Сохранение clothingTypes
    async saveClothingTypes() {
        try {
            await setDoc(doc(this.db, 'global', 'clothingTypes'), { types: this.clothingTypes });
        } catch (e) {
            console.error('Ошибка сохранения clothingTypes:', e);
            UIManager.showNotification(Translations[UIManager.currentLanguage].clothing_type_error, 'error');
        }
    },

    async saveData() {
        await this.saveClothingTypes();
    },

    // Логирование
    async logAction(action, details) {
        if (!this.currentUser) return;
        try {
            const historyRef = collection(this.db, `users/${this.currentUser}/data/history`);
            await addDoc(historyRef, {
                action,
                details,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            console.error('Ошибка логирования:', e);
        }
    },

    // Загрузка курсов валют
    async fetchExchangeRates() {
        try {
            const response = await fetch('https://api.exchangerate-api.com/v4/latest/KGS');
            const data = await response.json();
            this.exchangeRates = {
                KGS: 1,
                USD: data.rates.USD ? 1 / data.rates.USD : this.exchangeRates.USD,
                CNY: data.rates.CNY ? data.rates.CNY : this.exchangeRates.CNY,
                RUB: data.rates.RUB ? 1 / data.rates.RUB : this.exchangeRates.RUB
            };
        } catch (e) {
            console.error('Ошибка загрузки курсов валют:', e);
            UIManager.showNotification(Translations[UIManager.currentLanguage].currency_error, 'error');
        }
    },

    // Регистрация пользователя (дополняем данные в Firestore)
    async registerUser(username, email) {
        try {
            if (!this.auth.currentUser) throw new Error('Пользователь не аутентифицирован');
            const userRef = doc(this.db, `users/${this.auth.currentUser.uid}`);
            await setDoc(userRef, {
                username,
                email,
                createdAt: new Date().toISOString(),
                data: {
                    purchases: [],
                    sales: [],
                    salaries: [],
                    expenses: [],
                    history: [],
                    workers: [],
                    tasks: []
                }
            });
            await this.logAction('register_user', { username, email });
        } catch (e) {
            console.error('Ошибка регистрации в Firestore:', e);
            throw new Error(Translations[UIManager.currentLanguage].register_error);
        }
    },

    // Получение данных пользователя
    async getUserData() {
        if (!this.currentUser) {
            return { purchases: [], sales: [], salaries: [], expenses: [], history: [], workers: [], tasks: [] };
        }
        try {
            const collections = ['purchases', 'sales', 'salaries', 'expenses', 'history', 'workers', 'tasks'];
            const data = {};
            for (const coll of collections) {
                const querySnapshot = await getDocs(collection(this.db, `users/${this.currentUser}/data/${coll}`));
                data[coll] = [];
                querySnapshot.forEach((doc) => {
                    data[coll].push({ id: doc.id, ...doc.data() });
                });
            }
            return data;
        } catch (e) {
            console.error('Ошибка получения данных:', e);
            return { purchases: [], sales: [], salaries: [], expenses: [], history: [], workers: [], tasks: [] };
        }
    },

    // Расчёт зарплаты
    calculateSalary(grossSalary) {
        const tax = grossSalary * this.TAX_RATE;
        const social = grossSalary * this.SOCIAL_RATE;
        const netSalary = grossSalary - tax - social;
        return { grossSalary, tax, social, netSalary };
    },

    // Экспорт данных
    async exportData() {
        const data = {
            userData: await this.getUserData(),
            clothingTypes: this.clothingTypes
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sewing_accountant_data_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Импорт данных
    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.userData && data.clothingTypes) {
                        // Сохраняем clothingTypes
                        this.clothingTypes = data.clothingTypes;
                        await this.saveClothingTypes();
                        // Сохраняем пользовательские данные
                        if (this.currentUser) {
                            const collections = ['purchases', 'sales', 'salaries', 'expenses', 'history', 'workers', 'tasks'];
                            for (const coll of collections) {
                                const collRef = collection(this.db, `users/${this.currentUser}/data/${coll}`);
                                for (const item of data.userData[coll]) {
                                    await addDoc(collRef, item);
                                }
                            }
                        }
                        resolve();
                    } else {
                        reject(new Error(Translations[UIManager.currentLanguage].import_error));
                    }
                } catch (e) {
                    reject(new Error(Translations[UIManager.currentLanguage].import_error));
                }
            };
            reader.readAsText(file);
        });
    }
};

const UIManager = {
    currentCurrency: 'KGS',
    currentLanguage: localStorage.getItem('language') || 'ru',
    chart: null,
    analyticsChart: null,
    dashboardChart: null,
    currentWorkerId: null,
    isTabDragMode: false,
    tabOrder: ['dashboard', 'purchases', 'sales', 'workers', 'salaries', 'expenses', 'report', 'analytics'],
    globalFilter: { type: 'day', value: '' },

    async login() {
        const username = document.getElementById('authUsername').value.trim();
        const password = document.getElementById('authPassword').value;
        try {
            const email = `${username}@sewing-accountant.com`;
        const userCredential = await signInWithEmailAndPassword(window.firebaseAuth, email, password);
            DataManager.currentUser = userCredential.user.uid;
            await this.showMainInterface();
            await this.loadData();
            document.getElementById('currentUser').textContent = `${Translations[this.currentLanguage].user_label}${username}`;
            this.showNotification(Translations[this.currentLanguage].login_success, 'success');
        } catch (e) {
            console.error('Ошибка входа:', e);
            this.showNotification(Translations[this.currentLanguage].login_error, 'error');
        }
    },

    async registerUser() {
        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        try {
            if (password !== confirmPassword) {
                throw new Error(Translations[this.currentLanguage].register_password_mismatch);
            }
            const email = `${username}@sewing-accountant.com`;
            const userCredential = await createUserWithEmailAndPassword(window.firebaseAuth, email, password);
            DataManager.currentUser = userCredential.user.uid;
            await DataManager.registerUser(username, email);
            this.closeModal('registerModal');
            this.showModal('authModal');
            this.showNotification(Translations[this.currentLanguage].register_success, 'success');
        } catch (e) {
            console.error('Ошибка регистрации:', e);
            this.showNotification(e.message || Translations[this.currentLanguage].register_error, 'error');
        }
    },

    async logout() {
        try {
            await signOut(window.firebaseAuth);
            DataManager.currentUser = null;
            document.getElementById('authModal').classList.add('active');
            document.getElementById('header').style.display = 'none';
            document.getElementById('main').style.display = 'none';
            document.getElementById('authUsername').value = '';
            document.getElementById('authPassword').value = '';
            this.showNotification(Translations[this.currentLanguage].logout_success, 'success');
        } catch (e) {
            console.error('Ошибка выхода:', e);
            this.showNotification(Translations[this.currentLanguage].logout_error, 'error');
        }
    },

    showMainInterface() {
        document.getElementById('authModal').classList.remove('active');
        document.getElementById('header').style.display = 'flex';
        document.getElementById('main').style.display = 'block';
        this.changeLanguage();
    },

    toggleTheme() {
        document.body.classList.toggle('dark');
        localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
        document.getElementById('themeSelect').value = document.body.classList.contains('dark') ? 'dark' : 'light';
    },

    changeTheme() {
        const theme = document.getElementById('themeSelect').value;
        document.body.classList.remove('light', 'dark', 'midnight', 'forest', 'slate');
        document.body.classList.add(theme);
        localStorage.setItem('theme', theme);
        this.updateAllLists();
        this.updateDashboard();
        this.generateReport();
        this.updateAnalytics();
    },

    changeLanguage() {
        this.currentLanguage = document.getElementById('language').value;
        localStorage.setItem('language', this.currentLanguage);
        document.querySelectorAll('[data-translate]').forEach(el => {
            const key = el.getAttribute('data-translate');
            el.textContent = Translations[this.currentLanguage][key] || el.textContent;
        });
        document.querySelectorAll('[data-translate-placeholder]').forEach(el => {
            const key = el.getAttribute('data-translate-placeholder');
            el.placeholder = Translations[this.currentLanguage][key] || el.placeholder;
        });
        document.getElementById('currentUser').textContent = `${Translations[this.currentLanguage].user_label}${DataManager.currentUser || ''}`;
        this.updateAllLists();
        this.updateDashboard();
        this.generateReport();
        this.updateAnalytics();
    },

    async updateCurrency() {
        this.currentCurrency = document.getElementById('currency').value;
        await DataManager.fetchExchangeRates();
        this.updateAllLists();
        this.generateReport();
        this.updateAnalytics();
        this.updateDashboard();
        this.showNotification(Translations[this.currentLanguage].currency_updated, 'success');
    },

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        if (modalId === 'registerModal' || modalId === 'passwordModal' || modalId === 'importModal') {
            this.showModal('authModal');
        }
    },

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = 'notification';
        notification.classList.add(type);
        notification.classList.add('active');
        setTimeout(() => notification.classList.remove('active'), 3000);
    },

    showLoading(show) {
        const loading = document.getElementById('loading');
        loading.textContent = Translations[this.currentLanguage].loading;
        loading.classList[show ? 'add' : 'remove']('active');
    },

    convertToCurrentCurrency(amount) {
        return (amount / DataManager.exchangeRates[this.currentCurrency]).toFixed(2);
    },

    clearInputs(...ids) {
        ids.forEach(id => document.getElementById(id).value = '');
    },

    updateList(listId, items, renderFn) {
        const list = document.getElementById(listId);
        list.innerHTML = '';
        items.forEach((item, index) => {
            const li = document.createElement('li');
            li.innerHTML = renderFn(item, index);
            list.appendChild(li);
        });
    },

    filterItemsByDate(items, filterType, filterValue) {
        if (!filterValue) return items;
        return items.filter(item => {
            const itemDate = new Date(item.date);
            if (filterType === 'day') {
                return item.date === filterValue;
            } else if (filterType === 'month') {
                const [year, month] = filterValue.split('-');
                return itemDate.getFullYear() == year && itemDate.getMonth() == month;
            } else if (filterType === 'year') {
                return itemDate.getFullYear() == filterValue;
            }
            return true;
        });
    },

    updateAllLists() {
        const data = DataManager.getUserData();
        this.updatePurchaseList(this.filterItemsByDate(data.purchases || [], this.globalFilter.type, this.globalFilter.value));
        this.updateSaleList(this.filterItemsByDate(data.sales || [], this.globalFilter.type, this.globalFilter.value));
        this.updateSalaryList(this.filterItemsByDate(data.salaries || [], this.globalFilter.type, this.globalFilter.value));
        this.updateExpenseList(this.filterItemsByDate(data.expenses || [], this.globalFilter.type, this.globalFilter.value));
        this.updateWorkerList(data.workers || []);
        this.updateDashboard();
    },

    async loadData() {
        this.showLoading(true);
        await DataManager.fetchExchangeRates();
        const data = await DataManager.getUserData();
        this.updatePurchaseList(data.purchases || []);
        this.updateSaleList(data.sales || []);
        this.updateSalaryList(data.salaries || []);
        this.updateExpenseList(data.expenses || []);
        this.updateWorkerList(data.workers || []);
        this.updateDashboard();
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.classList.add(savedTheme);
        document.getElementById('themeSelect').value = savedTheme;
        const savedTabOrder = JSON.parse(localStorage.getItem('tabOrder'));
        if (savedTabOrder) {
            this.tabOrder = savedTabOrder;
            const tabsContainer = document.getElementById('tabs');
            const tabs = Array.from(tabsContainer.querySelectorAll('.tab-btn'));
            tabs.sort((a, b) => this.tabOrder.indexOf(a.dataset.tab) - this.tabOrder.indexOf(b.dataset.tab));
            tabs.forEach(tab => tabsContainer.appendChild(tab));
        }
        this.initTabDrag();
        this.populateAnalyticsYears();
        this.populateFilterYears();
        this.changeLanguage();
        this.showLoading(false);
    },

    async refreshData() {
        this.showLoading(true);
        await DataManager.fetchExchangeRates();
        this.updateAllLists();
        this.generateReport();
        this.updateAnalytics();
        this.showNotification(Translations[this.currentLanguage].data_refreshed, 'success');
        this.showLoading(false);
    },

    toggleTabDragMode() {
        this.isTabDragMode = !this.isTabDragMode;
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.draggable = this.isTabDragMode;
            tab.style.cursor = this.isTabDragMode ? 'grab' : 'pointer';
        });
        this.showNotification(this.isTabDragMode ? Translations[this.currentLanguage].drag_tabs : Translations[this.currentLanguage].drag_tabs + ' выключен', 'success');
    },

    initTabDrag() {
        const tabsContainer = document.getElementById('tabs');
        let draggedTab = null;

        tabsContainer.addEventListener('dragstart', (e) => {
            if (!this.isTabDragMode) return;
            draggedTab = e.target;
            draggedTab.classList.add('dragging');
        });

        tabsContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        tabsContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!this.isTabDragMode) return;
            const targetTab = e.target.closest('.tab-btn');
            if (targetTab && draggedTab !== targetTab) {
                const allTabs = Array.from(tabsContainer.querySelectorAll('.tab-btn'));
                const draggedIndex = allTabs.indexOf(draggedTab);
                const targetIndex = allTabs.indexOf(targetTab);
                const tabId = draggedTab.dataset.tab;
                this.tabOrder.splice(draggedIndex, 1);
                this.tabOrder.splice(targetIndex, 0, tabId);
                if (draggedIndex < targetIndex) {
                    targetTab.after(draggedTab);
                } else {
                    targetTab.before(draggedTab);
                }
                localStorage.setItem('tabOrder', JSON.stringify(this.tabOrder));
            }
            draggedTab.classList.remove('dragging');
            draggedTab = null;
        });

        tabsContainer.addEventListener('dragend', () => {
            if (draggedTab) {
                draggedTab.classList.remove('dragging');
                draggedTab = null;
            }
        });
    },

    async addPurchase() {
    const data = await DataManager.getUserData();
    const item = document.getElementById('purchaseItem').value.trim();
    const category = document.getElementById('purchaseCategory').value;
    const quantity = parseFloat(document.getElementById('purchaseQuantity').value);
    const cost = parseFloat(document.getElementById('purchaseCost').value) * DataManager.exchangeRates[this.currentCurrency];
    const description = document.getElementById('purchaseDescription').value.trim();
        if (item && quantity && cost) {
            const purchase = { item, category, quantity, cost: quantity * cost, description, date: new Date().toISOString().split('T')[0] };
            try {
                await addDoc(collection(DataManager.db, `users/${DataManager.currentUser}/data/purchases`), purchase);
                await DataManager.logAction('add_purchase', purchase);
                const updatedPurchases = await DataManager.getUserData().then(d => d.purchases);
                this.updatePurchaseList(updatedPurchases);
                this.clearInputs('purchaseItem', 'purchaseQuantity', 'purchaseCost', 'purchaseDescription');
                this.showNotification('Закупка добавлена!', 'success');
            } catch (e) {
                console.error('Ошибка добавления закупки:', e);
                this.showNotification('Ошибка при добавлении закупки!', 'error');
            }
        } else {
            this.showNotification('Заполните обязательные поля!', 'error');
        }
    },

    updatePurchaseList(purchases) {
        this.updateList('purchaseList', purchases, (p, index) => 
            `${p.date} - ${p.category}: ${p.item} (${p.quantity} м/кг/шт), ${this.convertToCurrentCurrency(p.cost)} ${this.currentCurrency}${p.description ? `, ${p.description}` : ''} <button onclick="UIManager.deletePurchase(${index})"><i class="fas fa-trash"></i></button>`
        );
    },

    async deletePurchase(index) {
        const data = await DataManager.getUserData();
        const li = document.getElementById('purchaseList').children[index];
        li.style.animation = 'fadeOut 0.3s ease';
        li.addEventListener('animationend', async () => {
            const purchase = data.purchases[index];
            try {
                await deleteDoc(doc(DataManager.db, `users/${DataManager.currentUser}/data/purchases`, purchase.id));
                await DataManager.logAction('delete_purchase', purchase);
                const updatedPurchases = await DataManager.getUserData().then(d => d.purchases);
                this.updatePurchaseList(updatedPurchases);
                this.showNotification('Закупка удалена!', 'success');
            } catch (e) {
                console.error('Ошибка удаления закупки:', e);
                this.showNotification('Ошибка при удалении закупки!', 'error');
            }
        }, { once: true });
    },
    
    async addSale() {
        const data = await DataManager.getUserData();
        const item = document.getElementById('saleItem').value.trim();
        const category = document.getElementById('saleCategory').value;
        const quantity = parseFloat(document.getElementById('saleQuantity').value);
        const amount = parseFloat(document.getElementById('saleAmount').value) * DataManager.exchangeRates[this.currentCurrency];
        const comment = document.getElementById('saleComment').value.trim();
        if (item && quantity && amount) {
            const totalAmount = quantity * amount;
            const vat = totalAmount * DataManager.VAT_RATE;
            const sale = { item, category, quantity, amount: totalAmount, vat, comment, date: new Date().toISOString().split('T')[0] };
            try {
                await addDoc(collection(DataManager.db, `users/${DataManager.currentUser}/data/sales`), sale);
                await DataManager.logAction('add_sale', sale);
                const updatedSales = await DataManager.getUserData().then(d => d.sales);
                this.updateSaleList(updatedSales);
                this.clearInputs('saleItem', 'saleQuantity', 'saleAmount', 'saleComment');
                this.showNotification('Продажа добавлена!', 'success');
            } catch (e) {
                console.error('Ошибка добавления продажи:', e);
                this.showNotification('Ошибка при добавлении продажи!', 'error');
            }
        } else {
            this.showNotification('Заполните обязательные поля!', 'error');
        }
    },

    updateSaleList(sales) {
        this.updateList('saleList', sales, (s, index) => 
            `${s.date} - ${s.category}: ${s.item} (${s.quantity} шт), ${this.convertToCurrentCurrency(s.amount)} ${this.currentCurrency}, НДС: ${this.convertToCurrentCurrency(s.vat)} ${this.currentCurrency}${s.comment ? `, ${s.comment}` : ''} <button onclick="UIManager.deleteSale(${index})"><i class="fas fa-trash"></i></button>`
        );
    },

    async deleteSale(index) {
        const data = await DataManager.getUserData();
        const li = document.getElementById('saleList').children[index];
        li.style.animation = 'fadeOut 0.3s ease';
        li.addEventListener('animationend', async () => {
            const sale = data.sales[index];
            try {
                await deleteDoc(doc(DataManager.db, `users/${DataManager.currentUser}/data/sales`, sale.id));
                await DataManager.logAction('delete_sale', sale);
                const updatedSales = await DataManager.getUserData().then(d => d.sales);
                this.updateSaleList(updatedSales);
                this.showNotification('Продажа удалена!', 'success');
            } catch (e) {
                console.error('Ошибка удаления продажи:', e);
                this.showNotification('Ошибка при удалении продажи!', 'error');
            }
        }, { once: true });
    },
    
    addWorker() {
        const data = DataManager.getUserData();
        const name = document.getElementById('workerName').value.trim();
        const role = document.getElementById('workerRole').value;
        const phone = document.getElementById('workerPhone').value.trim();
        const hireDate = document.getElementById('workerHireDate').value;
        const status = document.getElementById('workerStatus').value;
        if (name && role) {
            const worker = {
                id: Date.now(),
                name,
                role,
                phone: phone || '',
                hireDate: hireDate || new Date().toISOString().split('T')[0],
                status: status || 'active',
                date: new Date().toISOString().split('T')[0]
            };
            data.workers = data.workers || [];
            data.workers.push(worker);
            DataManager.logAction('add_worker', worker);
            const tasks = data.tasks.filter(t => t.workerId === worker.id);
            const grossSalary = tasks.reduce((sum, t) => sum + t.total, 0);
            const { tax, social, netSalary } = DataManager.calculateSalary(grossSalary);
            const salary = {
                workerId: worker.id,
                name,
                role,
                grossSalary,
                tax,
                social,
                netSalary,
                date: new Date().toISOString().split('T')[0]
            };
            data.salaries = data.salaries || [];
            data.salaries.push(salary);
            DataManager.logAction('add_salary', salary);
            this.updateWorkerList(data.workers);
            this.updateSalaryList(this.filterItemsByDate(data.salaries, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.clearInputs('workerName', 'workerPhone', 'workerHireDate');
            document.getElementById('workerStatus').value = 'active';
            this.showNotification(Translations[this.currentLanguage].worker_added, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        } else {
            this.showNotification(Translations[this.currentLanguage].worker_error, 'error');
        }
    },
    
    updateWorkerList(workers) {
        const statusFilter = document.getElementById('workerStatusFilter')?.value || 'all';
        const filteredWorkers = statusFilter === 'all' ? workers : workers.filter(w => w.status === statusFilter);
        this.updateList('workerList', filteredWorkers, (w, index) => {
            const data = DataManager.getUserData();
            const totalSalary = data.salaries
                .filter(s => s.workerId === w.id)
                .reduce((sum, s) => sum + s.netSalary, 0);
            return `${w.date} - ${w.name} (${w.role}, ${w.status === 'active' ? 'Активен' : 'Уволен'})${w.phone ? `, ${w.phone}` : ''}${w.hireDate ? `, Нанят: ${w.hireDate}` : ''}, Выплачено: ${this.convertToCurrentCurrency(totalSalary)} ${this.currentCurrency} <button onclick="UIManager.showEditWorker(${index})"><i class="fas fa-edit"></i></button> <button onclick="UIManager.showWorkerTasks(${w.id})"><i class="fas fa-tasks"></i></button> <button onclick="UIManager.deleteWorker(${index})"><i class="fas fa-trash"></i></button>`;
        });
    },
    
    deleteWorker(index) {
        const data = DataManager.getUserData();
        const li = document.getElementById('workerList').children[index];
        const deleteTasks = confirm(Translations[this.currentLanguage].confirm_delete_worker_tasks || 'Удалить все задачи сотрудника?');
        li.style.animation = 'fadeOut 0.3s ease';
        li.addEventListener('animationend', () => {
            const [deleted] = data.workers.splice(index, 1);
            if (deleteTasks) {
                data.tasks = data.tasks.filter(t => t.workerId !== deleted.id);
            }
            data.salaries = data.salaries.filter(s => s.workerId !== deleted.id);
            DataManager.logAction('delete_worker', deleted);
            this.updateWorkerList(data.workers);
            this.updateSalaryList(this.filterItemsByDate(data.salaries, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.showNotification(Translations[this.currentLanguage].worker_deleted, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        }, { once: true });
    },

    filterWorkersByStatus() {
        const data = DataManager.getUserData();
        this.updateWorkerList(data.workers);
    },

    showEditWorker(index) {
        const data = DataManager.getUserData();
        const worker = data.workers[index];
        this.currentWorkerIndex = index;
        document.getElementById('editWorkerName').value = worker.name;
        document.getElementById('editWorkerRole').value = worker.role;
        document.getElementById('editWorkerPhone').value = worker.phone || '';
        document.getElementById('editWorkerHireDate').value = worker.hireDate || '';
        document.getElementById('editWorkerStatus').value = worker.status || 'active';
        this.showModal('editWorkerModal');
    },
    
    saveWorkerEdit() {
        const data = DataManager.getUserData();
        const worker = data.workers[this.currentWorkerIndex];
        const name = document.getElementById('editWorkerName').value.trim();
        const role = document.getElementById('editWorkerRole').value;
        const phone = document.getElementById('editWorkerPhone').value.trim();
        const hireDate = document.getElementById('editWorkerHireDate').value;
        const status = document.getElementById('editWorkerStatus').value;
        if (name && role) {
            const updatedWorker = {
                ...worker,
                name,
                role,
                phone: phone || '',
                hireDate: hireDate || worker.hireDate,
                status: status || 'active'
            };
            data.workers[this.currentWorkerIndex] = updatedWorker;
            DataManager.logAction('edit_worker', updatedWorker);
            // Обновляем связанные зарплаты
            data.salaries = data.salaries.map(s => s.workerId === worker.id ? { ...s, name, role } : s);
            this.updateWorkerList(data.workers);
            this.updateSalaryList(this.filterItemsByDate(data.salaries, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.closeModal('editWorkerModal');
            this.showNotification(Translations[this.currentLanguage].worker_updated, 'success');
        } else {
            this.showNotification(Translations[this.currentLanguage].worker_error, 'error');
        }
    },
    
    showWorkerTasks(workerId) {
        const data = DataManager.getUserData();
        const worker = data.workers.find(w => w.id === workerId);
        if (worker) {
            document.getElementById('workerTasksTitle').textContent = Translations[this.currentLanguage].worker_tasks + `: ${worker.name} (${worker.role})`;
            this.currentWorkerId = workerId;
            const tasks = data.tasks.filter(t => t.workerId === workerId);
            this.updateWorkerTasksList(tasks);
            this.showModal('workerTasksModal');
            const taskTypeSelect = document.getElementById('taskType');
            taskTypeSelect.value = worker.role === 'Кройщик' ? 'Крой' :
                                  worker.role === 'Швея' ? 'Сшивание' :
                                  worker.role === 'Глажка' ? 'Глажка' :
                                  worker.role === 'Упаковка' ? 'Упаковка' : 'Крой';
            this.updateTaskForm(); // Инициализируем форму
        }
    },
    
    updateWorkerTasksList(tasks) {
        const priorityFilter = document.getElementById('taskPriorityFilter')?.value || 'all';
        const statusFilter = document.getElementById('taskStatusFilter')?.value || 'all';
        const filteredTasks = tasks.filter(t => 
            (priorityFilter === 'all' || t.priority === priorityFilter) &&
            (statusFilter === 'all' || t.status === statusFilter)
        );
        this.updateList('workerTasksList', filteredTasks, (t, index) => {
            const priorityText = t.priority === 'low' ? 'Низкий' : t.priority === 'medium' ? 'Средний' : 'Высокий';
            const statusText = t.status === 'pending' ? 'В процессе' : 'Выполнено';
            return `${t.date} - ${t.taskType}: ${t.clothingType || ''}${t.partType ? ` (${t.partType})` : ''}, ${t.quantity} ${Translations[this.currentLanguage].quantity}, ${this.convertToCurrentCurrency(t.total)} ${this.currentCurrency}, Приоритет: ${priorityText}${t.deadline ? `, Дедлайн: ${t.deadline}` : ''}${t.comment ? `, ${t.comment}` : ''}, Статус: ${statusText} <button onclick="UIManager.showEditTask(${index})"><i class="fas fa-edit"></i></button> <button onclick="UIManager.toggleTaskStatus(${index})"><i class="fas fa-check"></i></button> <button onclick="UIManager.deleteWorkerTask(${index})"><i class="fas fa-trash"></i></button>`;
        });
    },
    
    deleteWorkerTask(index) {
        const data = DataManager.getUserData();
        const li = document.getElementById('workerTasksList').children[index];
        li.style.animation = 'fadeOut 0.3s ease';
        li.addEventListener('animationend', () => {
            const tasks = data.tasks.filter(t => t.workerId === this.currentWorkerId);
            const [deleted] = tasks.splice(index, 1);
            data.tasks = data.tasks.filter(t => t.workerId !== this.currentWorkerId).concat(tasks);
            DataManager.logAction('delete_task', deleted);
            this.updateWorkerTasksList(tasks);
            DataManager.saveData();
            this.showNotification(Translations[this.currentLanguage].task_deleted, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        }, { once: true });
    },

    toggleTaskStatus(index) {
        const data = DataManager.getUserData();
        const tasks = data.tasks.filter(t => t.workerId === this.currentWorkerId);
        const task = tasks[index];
        task.status = task.status === 'pending' ? 'completed' : 'pending';
        DataManager.logAction('update_task_status', task);
        data.tasks = data.tasks.filter(t => t.workerId !== this.currentWorkerId).concat(tasks);
        DataManager.saveData();
        this.updateWorkerTasksList(tasks);
        this.showNotification(Translations[this.currentLanguage].task_status_updated, 'success');
    },

    filterWorkerTasks() {
        const data = DataManager.getUserData();
        const tasks = data.tasks.filter(t => t.workerId === this.currentWorkerId);
        this.updateWorkerTasksList(tasks);
    },
    
    addWorkerTask() {
        const data = DataManager.getUserData();
        const taskType = document.getElementById('taskType').value;
        const clothingType = (taskType === 'Глажка' || taskType === 'Упаковка') ? '' : document.getElementById('clothingType').value || '';
        const partType = (taskType === 'Глажка' || taskType === 'Упаковка') ? '' : document.getElementById('partType').value || '';
        const quantity = parseFloat(document.getElementById('taskQuantity').value);
        const rate = parseFloat(document.getElementById('taskRate').value) * DataManager.exchangeRates[this.currentCurrency];
        const priority = document.getElementById('taskPriority').value;
        const deadline = document.getElementById('taskDeadline').value;
        const comment = document.getElementById('taskComment').value.trim();
        if (taskType && quantity && rate) {
            const total = quantity * rate;
            const task = {
                workerId: this.currentWorkerId,
                taskType,
                clothingType,
                partType,
                quantity,
                rate,
                total,
                priority: priority || 'medium',
                deadline: deadline || '',
                comment: comment || '',
                status: 'pending',
                date: new Date().toISOString().split('T')[0]
            };
            data.tasks = data.tasks || [];
            data.tasks.push(task);
            DataManager.logAction('add_task', task);
            const tasks = data.tasks.filter(t => t.workerId === this.currentWorkerId);
            const grossSalary = tasks.reduce((sum, t) => sum + t.total, 0);
            const { tax, social, netSalary } = DataManager.calculateSalary(grossSalary);
            const worker = data.workers.find(w => w.id === this.currentWorkerId);
            const salary = {
                workerId: this.currentWorkerId,
                name: worker.name,
                role: worker.role,
                grossSalary,
                tax,
                social,
                netSalary,
                date: new Date().toISOString().split('T')[0]
            };
            data.salaries = data.salaries.filter(s => s.workerId !== this.currentWorkerId);
            data.salaries.push(salary);
            DataManager.logAction('update_salary', salary);
            this.updateWorkerTasksList(tasks);
            this.updateSalaryList(this.filterItemsByDate(data.salaries, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.clearInputs('taskQuantity', 'taskRate', 'taskTotal', 'taskDeadline', 'taskComment');
            document.getElementById('clothingType').value = '';
            document.getElementById('partType').value = '';
            document.getElementById('taskPriority').value = 'medium';
            this.updateTaskForm(); // Обновляем форму после добавления
            this.showNotification(Translations[this.currentLanguage].task_added, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        } else {
            this.showNotification(Translations[this.currentLanguage].task_error, 'error');
        }
    },
    
    updateClothingOptions(prefix = '') {
        const taskType = document.getElementById(prefix + 'taskType').value;
        if (taskType === 'Глажка' || taskType === 'Упаковка') return; // Не обновляем для этих типов
        const clothingTypeSelect = document.getElementById(prefix + 'clothingType');
        const partTypeSelect = document.getElementById(prefix + 'partType');
        clothingTypeSelect.innerHTML = '<option value="">Выберите тип одежды</option>' + 
                                      Object.keys(DataManager.clothingTypes).map(type => 
                                          `<option value="${type}">${type}</option>`).join('');
        partTypeSelect.innerHTML = '<option value="">Выберите часть</option>';
    },
    
    addCustomClothingType() {
        const clothingType = document.getElementById('newClothingType').value.trim();
        if (clothingType && !DataManager.clothingTypes[clothingType]) {
            DataManager.clothingTypes[clothingType] = [];
            DataManager.saveData();
            this.updateClothingOptions();
            this.updateClothingOptions('edit');
            this.updateClothingTypeList();
            document.getElementById('newClothingType').value = '';
            this.showNotification(Translations[this.currentLanguage].clothing_type_added, 'success');
        } else {
            this.showNotification(Translations[this.currentLanguage].clothing_type_error, 'error');
        }
    },

    updateClothingTypeList() {
        const clothingTypes = Object.keys(DataManager.clothingTypes);
        this.updateList('clothingTypeList', clothingTypes, (type, index) => 
            `${type} <button onclick="UIManager.editClothingType('${type}')"><i class="fas fa-edit"></i></button> <button onclick="UIManager.deleteClothingType('${type}')"><i class="fas fa-trash"></i></button>`
        );
    },
    
    addCustomPartType() {
        const clothingType = document.getElementById('clothingTypeForParts').value;
        const partType = document.getElementById('newPartType').value.trim();
        if (clothingType && partType && DataManager.clothingTypes[clothingType] && !DataManager.clothingTypes[clothingType].includes(partType)) {
            DataManager.clothingTypes[clothingType].push(partType);
            DataManager.saveData();
            this.updatePartOptions();
            this.updatePartOptions('edit');
            this.updatePartTypeList();
            document.getElementById('newPartType').value = '';
            this.showNotification(Translations[this.currentLanguage].part_type_added, 'success');
        } else {
            this.showNotification(Translations[this.currentLanguage].part_type_error, 'error');
        }
    },

    updatePartTypeList() {
        const clothingType = document.getElementById('clothingTypeForParts').value;
        const parts = clothingType && DataManager.clothingTypes[clothingType] ? DataManager.clothingTypes[clothingType] : [];
        this.updateList('partTypeList', parts, (part, index) => 
            `${part} <button onclick="UIManager.editPartType('${clothingType}', '${part}')"><i class="fas fa-edit"></i></button> <button onclick="UIManager.deletePartType('${clothingType}', '${part}')"><i class="fas fa-trash"></i></button>`
        );
    },
    
    updatePartOptions(prefix = '') {
        const clothingType = document.getElementById(prefix + 'clothingType').value;
        const partTypeSelect = document.getElementById(prefix + 'partType');
        partTypeSelect.innerHTML = '<option value="">Выберите часть</option>' + 
                                  (clothingType && DataManager.clothingTypes[clothingType] ? 
                                      DataManager.clothingTypes[clothingType].map(part => 
                                          `<option value="${part}">${part}</option>`).join('') : '');
    },
    
    calculateTaskTotal(prefix = '') {
        const quantity = parseFloat(document.getElementById(prefix + 'taskQuantity').value) || 0;
        const rate = parseFloat(document.getElementById(prefix + 'taskRate').value) || 0;
        const total = (quantity * rate).toFixed(2);
        document.getElementById(prefix + 'taskTotal').value = total;
    },
    
    updateSalaryList(salaries = null) {
        const data = DataManager.getUserData();
        const filterType = document.getElementById('salaryFilterType')?.value || this.globalFilter.type;
        const filterValue = filterType === 'day' ? document.getElementById('salaryFilterDay')?.value || this.globalFilter.value :
                            filterType === 'month' ? `${document.getElementById('salaryFilterYear')?.value}-${document.getElementById('salaryFilterMonth')?.value}` :
                            document.getElementById('salaryFilterYear')?.value || this.globalFilter.value;
        const filteredSalaries = this.filterItemsByDate(salaries || data.salaries, filterType, filterValue);
        this.updateList('salaryList', filteredSalaries, (s, index) => 
            `${new Date(s.date).toLocaleDateString(this.currentLanguage)} - ${s.name} (${s.role}): ${Translations[this.currentLanguage].gross_salary}: ${this.convertToCurrentCurrency(s.grossSalary)} ${this.currentCurrency}, ${Translations[this.currentLanguage].tax}: ${this.convertToCurrentCurrency(s.tax)} ${this.currentCurrency}, ${Translations[this.currentLanguage].social}: ${this.convertToCurrentCurrency(s.social)} ${this.currentCurrency}, ${Translations[this.currentLanguage].net_salary}: ${this.convertToCurrentCurrency(s.netSalary)} ${this.currentCurrency} <button onclick="UIManager.deleteSalary(${index})"><i class="fas fa-trash"></i></button>`
        );
    },
    
    updateSalaryFilterInputs() {
        const filterType = document.getElementById('salaryFilterType').value;
        document.getElementById('salaryFilterDay').style.display = filterType === 'day' ? 'block' : 'none';
        document.getElementById('salaryFilterMonth').style.display = filterType === 'month' ? 'block' : 'none';
        document.getElementById('salaryFilterYear').style.display = filterType === 'month' || filterType === 'year' ? 'block' : 'none';
    },
    
    deleteSalary(index) {
        const data = DataManager.getUserData();
        const li = document.getElementById('salaryList').children[index];
        li.style.animation = 'fadeOut 0.3s ease';
        li.addEventListener('animationend', () => {
            const filteredSalaries = this.filterItemsByDate(data.salaries, this.globalFilter.type, this.globalFilter.value);
            const [deleted] = filteredSalaries.splice(index, 1);
            data.salaries = data.salaries.filter(s => s !== deleted);
            DataManager.logAction('delete_salary', deleted);
            this.updateSalaryList();
            DataManager.saveData();
            this.showNotification(Translations[this.currentLanguage].salary_deleted, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        }, { once: true });
    },

    showClothingPartManager() {
        const clothingTypeSelect = document.getElementById('clothingTypeForParts');
        clothingTypeSelect.innerHTML = '<option value="">Выберите тип одежды</option>' + 
                                      Object.keys(DataManager.clothingTypes).map(type => 
                                          `<option value="${type}">${type}</option>`).join('');
        this.updateClothingTypeList();
        this.updatePartTypeList();
        this.showModal('clothingPartManagerModal');
    },

    editClothingType(oldType) {
        const newType = prompt(Translations[this.currentLanguage].edit_clothing_type, oldType);
        if (newType && newType.trim() && newType !== oldType && !DataManager.clothingTypes[newType]) {
            DataManager.clothingTypes[newType] = DataManager.clothingTypes[oldType];
            delete DataManager.clothingTypes[oldType];
            // Обновляем задачи с новым типом одежды
            const data = DataManager.getUserData();
            data.tasks = data.tasks.map(t => t.clothingType === oldType ? { ...t, clothingType: newType } : t);
            DataManager.saveData();
            this.updateClothingOptions();
            this.updateClothingOptions('edit');
            this.updateClothingTypeList();
            this.showNotification(Translations[this.currentLanguage].clothing_type_updated, 'success');
        } else {
            this.showNotification(Translations[this.currentLanguage].clothing_type_error, 'error');
        }
    },

    deleteClothingType(type) {
        if (confirm(Translations[this.currentLanguage].confirm_delete_clothing_type)) {
            delete DataManager.clothingTypes[type];
            // Очищаем clothingType в задачах
            const data = DataManager.getUserData();
            data.tasks = data.tasks.map(t => t.clothingType === type ? { ...t, clothingType: '', partType: '' } : t);
            DataManager.saveData();
            this.updateClothingOptions();
            this.updateClothingOptions('edit');
            this.updateClothingTypeList();
            this.updatePartTypeList();
            this.showNotification(Translations[this.currentLanguage].clothing_type_deleted, 'success');
        }
    },

    editPartType(clothingType, oldPart) {
        const newPart = prompt(Translations[this.currentLanguage].edit_part_type, oldPart);
        if (newPart && newPart.trim() && newPart !== oldPart && !DataManager.clothingTypes[clothingType].includes(newPart)) {
            const index = DataManager.clothingTypes[clothingType].indexOf(oldPart);
            DataManager.clothingTypes[clothingType][index] = newPart;
            // Обновляем задачи с новой частью
            const data = DataManager.getUserData();
            data.tasks = data.tasks.map(t => t.clothingType === clothingType && t.partType === oldPart ? { ...t, partType: newPart } : t);
            DataManager.saveData();
            this.updatePartOptions();
            this.updatePartOptions('edit');
            this.updatePartTypeList();
            this.showNotification(Translations[this.currentLanguage].part_type_updated, 'success');
        } else {
            this.showNotification(Translations[this.currentLanguage].part_type_error, 'error');
        }
    },

    deletePartType(clothingType, part) {
        if (confirm(Translations[this.currentLanguage].confirm_delete_part_type)) {
            DataManager.clothingTypes[clothingType] = DataManager.clothingTypes[clothingType].filter(p => p !== part);
            // Очищаем partType в задачах
            const data = DataManager.getUserData();
            data.tasks = data.tasks.map(t => t.clothingType === clothingType && t.partType === part ? { ...t, partType: '' } : t);
            DataManager.saveData();
            this.updatePartOptions();
            this.updatePartOptions('edit');
            this.updatePartTypeList();
            this.showNotification(Translations[this.currentLanguage].part_type_deleted, 'success');
        }
    },

    showEditTask(index) {
        const data = DataManager.getUserData();
        const tasks = data.tasks.filter(t => t.workerId === this.currentWorkerId);
        if (!tasks[index]) {
            this.showNotification(Translations[this.currentLanguage].task_error, 'error');
            return;
        }
        const task = tasks[index];
        this.currentTaskIndex = index;
        document.getElementById('editTaskType').value = task.taskType;
        document.getElementById('editClothingType').value = task.clothingType || '';
        document.getElementById('editPartType').value = task.partType || '';
        document.getElementById('editTaskQuantity').value = task.quantity;
        document.getElementById('editTaskRate').value = (task.rate / DataManager.exchangeRates[this.currentCurrency]).toFixed(2);
        document.getElementById('editTaskTotal').value = task.total.toFixed(2);
        document.getElementById('editTaskPriority').value = task.priority;
        document.getElementById('editTaskDeadline').value = task.deadline || '';
        document.getElementById('editTaskComment').value = task.comment || '';
        document.getElementById('editTaskStatus').value = task.status;
        this.updateTaskForm('edit'); // Инициализируем форму редактирования
        this.calculateTaskTotal('edit'); // Инициализируем "Итого"
        this.showModal('editTaskModal');
    },

    saveTaskEdit() {
        const data = DataManager.getUserData();
        const tasks = data.tasks.filter(t => t.workerId === this.currentWorkerId);
        if (!tasks[this.currentTaskIndex]) {
            this.showNotification(Translations[this.currentLanguage].task_error, 'error');
            return;
        }
        const task = tasks[this.currentTaskIndex];
        const taskType = document.getElementById('editTaskType').value;
        const clothingType = (taskType === 'Глажка' || taskType === 'Упаковка') ? '' : document.getElementById('editClothingType').value || '';
        const partType = (taskType === 'Глажка' || taskType === 'Упаковка') ? '' : document.getElementById('editPartType').value || '';
        const quantity = parseFloat(document.getElementById('editTaskQuantity').value);
        const rate = parseFloat(document.getElementById('editTaskRate').value) * DataManager.exchangeRates[this.currentCurrency];
        const priority = document.getElementById('editTaskPriority').value;
        const deadline = document.getElementById('editTaskDeadline').value;
        const comment = document.getElementById('editTaskComment').value.trim();
        const status = document.getElementById('editTaskStatus').value;
        if (taskType && quantity && rate) {
            const total = quantity * rate;
            const updatedTask = {
                ...task,
                taskType,
                clothingType,
                partType,
                quantity,
                rate,
                total,
                priority: priority || 'medium',
                deadline: deadline || '',
                comment: comment || '',
                status
            };
            tasks[this.currentTaskIndex] = updatedTask;
            data.tasks = data.tasks.filter(t => t.workerId !== this.currentWorkerId).concat(tasks);
            DataManager.logAction('edit_task', updatedTask);
            const grossSalary = tasks.reduce((sum, t) => sum + t.total, 0);
            const { tax, social, netSalary } = DataManager.calculateSalary(grossSalary);
            const worker = data.workers.find(w => w.id === this.currentWorkerId);
            const salary = {
                workerId: this.currentWorkerId,
                name: worker.name,
                role: worker.role,
                grossSalary,
                tax,
                social,
                netSalary,
                date: new Date().toISOString().split('T')[0]
            };
            data.salaries = data.salaries.filter(s => s.workerId !== this.currentWorkerId);
            data.salaries.push(salary);
            DataManager.logAction('update_salary', salary);
            this.updateWorkerTasksList(tasks);
            this.updateSalaryList(this.filterItemsByDate(data.salaries, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.closeModal('editTaskModal');
            this.showNotification(Translations[this.currentLanguage].task_updated, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        } else {
            this.showNotification(Translations[this.currentLanguage].task_error, 'error');
        }
    },
    
    updateTaskForm(prefix = '') {
        const taskType = document.getElementById(prefix + 'taskType')?.value;
        const clothingTypeSelect = document.getElementById(prefix + 'clothingType');
        const partTypeSelect = document.getElementById(prefix + 'partType');
        const managerBtn = document.getElementById(prefix + 'clothingPartManagerBtn');
    
        if (!taskType || !clothingTypeSelect || !partTypeSelect || !managerBtn) return; // Защита от ошибок
    
        if (taskType === 'Глажка' || taskType === 'Упаковка') {
            clothingTypeSelect.classList.add('hidden');
            partTypeSelect.classList.add('hidden');
            managerBtn.classList.add('hidden');
            clothingTypeSelect.value = ''; // Сбрасываем выбор
            partTypeSelect.value = '';
        } else {
            clothingTypeSelect.classList.remove('hidden');
            partTypeSelect.classList.remove('hidden');
            managerBtn.classList.remove('hidden');
            this.updateClothingOptions(prefix); // Обновляем список типов одежды
            this.updatePartOptions(prefix); // Обновляем список частей
        }
    },

    addElectricity() {
        this.addExpense('electricity', { cost: 'electricityCost' });
    },
    
    addRepair() {
        this.addExpense('repair', { desc: 'repairDesc', cost: 'repairCost' });
    },
    
    addRent() {
        this.addExpense('rent', { desc: 'rentDesc', cost: 'rentCost' });
    },
    
    addTransport() {
        this.addExpense('transport', { desc: 'transportDesc', cost: 'transportCost' });
    },
    
    addExpense(type, inputs) {
        const data = DataManager.getUserData();
        const expense = { type, date: new Date().toISOString().split('T')[0] };
        if (inputs.desc) {
            expense.description = document.getElementById(inputs.desc).value.trim();
        }
        expense.cost = parseFloat(document.getElementById(inputs.cost).value) * DataManager.exchangeRates[this.currentCurrency];
        if (expense.cost && (!inputs.desc || expense.description)) {
            data.expenses = data.expenses || [];
            data.expenses.push(expense);
            DataManager.logAction(`add_${type}`, expense);
            this.updateExpenseList(this.filterItemsByDate(data.expenses, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.clearInputs(inputs.desc, inputs.cost);
            this.showNotification(Translations[this.currentLanguage][`${type}_added`], 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        } else {
            this.showNotification(Translations[this.currentLanguage][`${type}_error`], 'error');
        }
    },
    
    updateExpenseList(expenses) {
        this.updateList('expenseList', expenses, (e, index) => 
            `${e.date} - ${Translations[this.currentLanguage][e.type]}: ${this.convertToCurrentCurrency(e.cost)} ${this.currentCurrency}${e.description ? `, ${e.description}` : ''} <button onclick="UIManager.deleteExpense(${index})"><i class="fas fa-trash"></i></button>`
        );
    },
    
    deleteExpense(index) {
        const data = DataManager.getUserData();
        const li = document.getElementById('expenseList').children[index];
        li.style.animation = 'fadeOut 0.3s ease';
        li.addEventListener('animationend', () => {
            const filteredExpenses = this.filterItemsByDate(data.expenses, this.globalFilter.type, this.globalFilter.value);
            const [deleted] = filteredExpenses.splice(index, 1);
            data.expenses = data.expenses.filter(e => e !== deleted);
            DataManager.logAction('delete_expense', deleted);
            this.updateExpenseList(filteredExpenses);
            DataManager.saveData();
            this.showNotification(Translations[this.currentLanguage].expense_deleted, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        }, { once: true });
    },
    
    calculateTotals(filterType = '', filterValue = '') {
        const data = DataManager.getUserData();
        const filteredPurchases = filterType ? this.filterItemsByDate(data.purchases, filterType, filterValue) : data.purchases;
        const filteredSales = filterType ? this.filterItemsByDate(data.sales, filterType, filterValue) : data.sales;
        const filteredExpenses = filterType ? this.filterItemsByDate(data.expenses, filterType, filterValue) : data.expenses;
        const filteredSalaries = filterType ? this.filterItemsByDate(data.salaries, filterType, filterValue) : data.salaries;
    
        const salesTotal = filteredSales.reduce((sum, s) => sum + s.amount, 0);
        const vatTotal = filteredSales.reduce((sum, s) => sum + s.vat, 0);
        const purchasesTotal = filteredPurchases.reduce((sum, p) => sum + p.cost, 0);
        const expensesTotal = filteredExpenses.reduce((sum, e) => sum + e.cost, 0);
        const salariesGross = filteredSalaries.reduce((sum, s) => sum + s.grossSalary, 0);
        const taxTotal = filteredSalaries.reduce((sum, s) => sum + s.tax, 0);
        const socialTotal = filteredSalaries.reduce((sum, s) => sum + s.social, 0);
        const profit = salesTotal - (purchasesTotal + expensesTotal + salariesGross + vatTotal + taxTotal + socialTotal);
    
        return { salesTotal, purchasesTotal, expensesTotal, salariesGross, taxTotal, socialTotal, vatTotal, profit };
    },
    
    updateDashboard() {
        const filterType = document.getElementById('dashboardFilterType')?.value || 'month';
        const filterMonth = document.getElementById('dashboardFilterMonth')?.value;
        const filterYear = document.getElementById('dashboardFilterYear')?.value;
        const filterValue = filterType === 'month' && filterYear && filterMonth !== '' ? `${filterYear}-${filterMonth}` : filterYear;
    
        // Используем calculateTotals с учётом нового типа фильтра
        const totals = this.calculateTotals(filterType === 'month' ? 'month' : filterType === 'year' ? 'year' : '', filterType === 'month' ? filterValue : filterType === 'year' ? filterYear : '');
    
        document.getElementById('dashboardSales').textContent = `${this.convertToCurrentCurrency(totals.salesTotal)} ${this.currentCurrency}`;
        document.getElementById('dashboardExpenses').textContent = `${this.convertToCurrentCurrency(totals.purchasesTotal + totals.expensesTotal)} ${this.currentCurrency}`;
        document.getElementById('dashboardSalaries').textContent = `${this.convertToCurrentCurrency(totals.salariesGross)} ${this.currentCurrency}`;
        document.getElementById('dashboardProfit').textContent = `${this.convertToCurrentCurrency(totals.profit)} ${this.currentCurrency}`;
    
        if (this.dashboardChart) {
            this.dashboardChart.destroy();
        }
        const ctx = document.getElementById('dashboardChart').getContext('2d');
        this.dashboardChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [
                    Translations[this.currentLanguage].sales,
                    Translations[this.currentLanguage].purchases,
                    Translations[this.currentLanguage].expenses,
                    Translations[this.currentLanguage].salaries,
                    Translations[this.currentLanguage].profit
                ],
                datasets: [{
                    data: [
                        totals.salesTotal,
                        totals.purchasesTotal,
                        totals.expensesTotal,
                        totals.salariesGross,
                        totals.profit
                    ].map(v => parseFloat(this.convertToCurrentCurrency(v))),
                    backgroundColor: ['#34d399', '#f87171', '#facc15', '#60a5fa', '#10b981'],
                    borderWidth: 1,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                animation: { duration: 1000, easing: 'easeOutQuart' },
                plugins: {
                    legend: { position: 'bottom', labels: { color: document.body.classList.contains('dark') ? '#e2e8f0' : '#1a202c' } },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} ${this.currentCurrency}` } }
                },
                cutout: '60%'
            }
        });
    },

    updateDashboardFilterInputs() {
        const filterType = document.getElementById('dashboardFilterType')?.value || 'month';
        const monthFilter = document.getElementById('dashboardFilterMonth');
        const yearFilter = document.getElementById('dashboardFilterYear');
    
        if (monthFilter && yearFilter) {
            if (filterType === 'month') {
                monthFilter.classList.remove('hidden');
                yearFilter.classList.remove('hidden');
            } else if (filterType === 'year') {
                monthFilter.classList.add('hidden');
                yearFilter.classList.remove('hidden');
            } else if (filterType === 'all') {
                monthFilter.classList.add('hidden');
                yearFilter.classList.add('hidden');
            }
            this.updateDashboard(); // Обновляем данные при изменении типа фильтра
        }
    },
    
    generateReport() {
        const data = DataManager.getUserData();
        const dateFilter = document.getElementById('dateFilter').value || this.globalFilter.value;
        const filterType = this.globalFilter.type;
        const totals = this.calculateTotals(filterType, dateFilter);
    
        const filteredPurchases = this.filterItemsByDate(data.purchases || [], filterType, dateFilter);
        const filteredSales = this.filterItemsByDate(data.sales || [], filterType, dateFilter);
        const filteredExpenses = this.filterItemsByDate(data.expenses || [], filterType, dateFilter);
        const filteredSalaries = this.filterItemsByDate(data.salaries || [], filterType, dateFilter);
        const filteredTasks = this.filterItemsByDate(data.tasks || [], filterType, dateFilter);
    
        // Форматирование периода отчета
        let periodText = Translations[this.currentLanguage].all_time || 'За всё время';
        try {
            if (filterType === 'day' && dateFilter) {
                periodText = new Date(dateFilter).toLocaleDateString(this.currentLanguage);
            } else if (filterType === 'month' && dateFilter) {
                const [year, month] = dateFilter.split('-');
                periodText = `${Translations[this.currentLanguage][`month_${parseInt(month) - 1}`] || month} ${year}`;
            } else if (filterType === 'year' && dateFilter) {
                periodText = dateFilter;
            }
        } catch (e) {
            console.error('Ошибка форматирования периода:', e);
        }
    
        // Создание HTML-отчета
        let report = `
            <h3>${Translations[this.currentLanguage].report || 'Отчет'} (${periodText})</h3>
            <p><strong>${Translations[this.currentLanguage].user_label || 'Пользователь'}:</strong> ${DataManager.currentUser || 'Неизвестно'}</p>
            <p><strong>${Translations[this.currentLanguage].currency || 'Валюта'}:</strong> ${this.currentCurrency}</p>
            <p><strong>${Translations[this.currentLanguage].generated || 'Сгенерировано'}:</strong> ${new Date().toLocaleString(this.currentLanguage)}</p>
            
            <h4>${Translations[this.currentLanguage].summary || 'Итог'}</h4>
            <p><span class="category">${Translations[this.currentLanguage].purchases || 'Закупки'}:</span> ${this.convertToCurrentCurrency(totals.purchasesTotal)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].sales || 'Продажи'}:</span> ${this.convertToCurrentCurrency(totals.salesTotal)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].expenses || 'Расходы'}:</span> ${this.convertToCurrentCurrency(totals.expensesTotal)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].salaries || 'Зарплаты'}:</span> ${this.convertToCurrentCurrency(totals.salariesGross)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].tax || 'Налог'}:</span> ${this.convertToCurrentCurrency(totals.taxTotal)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].social || 'Соц. отчисления'}:</span> ${this.convertToCurrentCurrency(totals.socialTotal)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].vat || 'НДС'}:</span> ${this.convertToCurrentCurrency(totals.vatTotal)} ${this.currentCurrency}</p>
            <p><span class="category">${Translations[this.currentLanguage].profit || 'Прибыль'}:</span> ${this.convertToCurrentCurrency(totals.profit)} ${this.currentCurrency} ${totals.profit < 0 ? '<span class="negative">(' + (Translations[this.currentLanguage].negative || 'Отрицательная') + ')</span>' : ''}</p>
            
            <h4>${Translations[this.currentLanguage].purchases || 'Закупки'}</h4>
            ${filteredPurchases.length ? filteredPurchases.map(p => `
                <p>${p.date} - ${p.category || '-'}: ${p.item || '-'} (${p.quantity || 0} ${Translations[this.currentLanguage].quantity || 'шт/м/кг'}), ${this.convertToCurrentCurrency(p.cost || 0)} ${this.currentCurrency}${p.description ? `, ${p.description}` : ''}</p>
            `).join('') : `<p>${Translations[this.currentLanguage].no_data || 'Нет данных'}</p>`}
            
            <h4>${Translations[this.currentLanguage].sales || 'Продажи'}</h4>
            ${filteredSales.length ? filteredSales.map(s => `
                <p>${s.date} - ${s.category || '-'}: ${s.item || '-'} (${s.quantity || 0} ${Translations[this.currentLanguage].quantity || 'шт'}), ${this.convertToCurrentCurrency(s.amount || 0)} ${this.currentCurrency}, ${Translations[this.currentLanguage].vat || 'НДС'}: ${this.convertToCurrentCurrency(s.vat || 0)} ${this.currentCurrency}${s.comment ? `, ${s.comment}` : ''}</p>
            `).join('') : `<p>${Translations[this.currentLanguage].no_data || 'Нет данных'}</p>`}
            
            <h4>${Translations[this.currentLanguage].expenses || 'Расходы'}</h4>
            ${filteredExpenses.length ? filteredExpenses.map(e => `
                <p>${e.date} - ${Translations[this.currentLanguage][e.type] || e.type}: ${this.convertToCurrentCurrency(e.cost || 0)} ${this.currentCurrency}${e.description ? `, ${e.description}` : ''}</p>
            `).join('') : `<p>${Translations[this.currentLanguage].no_data || 'Нет данных'}</p>`}
            
            <h4>${Translations[this.currentLanguage].salaries || 'Зарплаты'}</h4>
            ${filteredSalaries.length ? filteredSalaries.map(s => `
                <p>${new Date(s.date).toLocaleDateString(this.currentLanguage)} - ${s.name || '-'} (${s.role || '-'}): ${Translations[this.currentLanguage].gross_salary || 'Валовая зарплата'}: ${this.convertToCurrentCurrency(s.grossSalary || 0)} ${this.currentCurrency}, ${Translations[this.currentLanguage].tax || 'Налог'}: ${this.convertToCurrentCurrency(s.tax || 0)} ${this.currentCurrency}, ${Translations[this.currentLanguage].social || 'Соц. отчисления'}: ${this.convertToCurrentCurrency(s.social || 0)} ${this.currentCurrency}, ${Translations[this.currentLanguage].net_salary || 'Чистая зарплата'}: ${this.convertToCurrentCurrency(s.netSalary || 0)} ${this.currentCurrency}</p>
            `).join('') : `<p>${Translations[this.currentLanguage].no_data || 'Нет данных'}</p>`}
            
            <h4>${Translations[this.currentLanguage].worker_tasks || 'Задачи сотрудников'}</h4>
            ${filteredTasks.length ? filteredTasks.map(t => `
                <p>${t.date} - ${t.taskType || '-'}: ${t.clothingType || ''}${t.partType ? ` (${t.partType})` : ''}, ${t.quantity || 0} ${Translations[this.currentLanguage].quantity || 'шт'}, ${this.convertToCurrentCurrency(t.total || 0)} ${this.currentCurrency} (${Translations[this.currentLanguage].worker || 'Сотрудник'}: ${data.workers.find(w => w.id === t.workerId)?.name || Translations[this.currentLanguage].unknown || 'Неизвестно'})</p>
            `).join('') : `<p>${Translations[this.currentLanguage].no_data || 'Нет данных'}</p>`}
        `;
        
        document.getElementById('reportOutput').innerHTML = report;
    
        // Сохранение текущей диаграммы (без изменений)
        if (this.chart) {
            this.chart.destroy();
        }
        const ctx = document.getElementById('reportChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [
                    Translations[this.currentLanguage].purchases,
                    Translations[this.currentLanguage].sales,
                    Translations[this.currentLanguage].expenses,
                    Translations[this.currentLanguage].salaries,
                    Translations[this.currentLanguage].tax,
                    Translations[this.currentLanguage].social,
                    Translations[this.currentLanguage].vat,
                    Translations[this.currentLanguage].profit
                ],
                datasets: [{
                    label: Translations[this.currentLanguage].amount,
                    data: [
                        filteredPurchases.reduce((sum, p) => sum + (p.cost || 0), 0),
                        filteredSales.reduce((sum, s) => sum + (s.amount || 0), 0),
                        filteredExpenses.reduce((sum, e) => sum + (e.cost || 0), 0),
                        filteredSalaries.reduce((sum, s) => sum + (s.grossSalary || 0), 0),
                        filteredSalaries.reduce((sum, s) => sum + (s.tax || 0), 0),
                        filteredSalaries.reduce((sum, s) => sum + (s.social || 0), 0),
                        filteredSales.reduce((sum, s) => sum + (s.vat || 0), 0),
                        totals.profit
                    ].map(v => parseFloat(this.convertToCurrentCurrency(v))),
                    backgroundColor: ['#f87171', '#34d399', '#facc15', '#60a5fa', '#ef4444', '#f59e0b', '#3b82f6', '#10b981'],
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                animation: { duration: 1000, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} ${this.currentCurrency}` } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => `${v} ${this.currentCurrency}` } }
                }
            }
        });
    },
    
    downloadPDF: function() {
        this.showLoading(true);
        try {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) {
                throw new Error('Библиотека jsPDF не загружена');
            }
            const doc = new jsPDF();
            doc.setFont('helvetica', 'normal');
    
            const dateFilter = document.getElementById('dateFilter').value || this.globalFilter.value;
            const filterType = this.globalFilter.type;
            const data = DataManager.getUserData();
            const totals = this.calculateTotals(filterType, dateFilter);
    
            const filteredPurchases = this.filterItemsByDate(data.purchases || [], filterType, dateFilter);
            const filteredSales = this.filterItemsByDate(data.sales || [], filterType, dateFilter);
            const filteredExpenses = this.filterItemsByDate(data.expenses || [], filterType, dateFilter);
            const filteredSalaries = this.filterItemsByDate(data.salaries || [], filterType, dateFilter);
            const filteredTasks = this.filterItemsByDate(data.tasks || [], filterType, dateFilter);
    
            // Форматирование периода
            let periodText = Translations[this.currentLanguage].all_time || 'All time';
            try {
                if (filterType === 'day' && dateFilter) {
                    periodText = new Date(dateFilter).toLocaleDateString(this.currentLanguage);
                } else if (filterType === 'month' && dateFilter) {
                    const [year, month] = dateFilter.split('-');
                    periodText = `${Translations[this.currentLanguage][`month_${parseInt(month) - 1}`] || month} ${year}`;
                } else if (filterType === 'year' && dateFilter) {
                    periodText = dateFilter;
                }
            } catch (e) {
                console.error('Ошибка форматирования периода:', e);
            }
    
            // Функция для разбиения длинных строк
            const splitText = (text, maxWidth) => {
                const words = text.split(' ');
                let line = '';
                const lines = [];
                words.forEach(word => {
                    if (doc.getTextWidth(line + word) < maxWidth) {
                        line += (line ? ' ' : '') + word;
                    } else {
                        lines.push(line);
                        line = word;
                    }
                });
                if (line) lines.push(line);
                return lines;
            };
    
            // Заголовок
            doc.setFontSize(16);
            doc.text(`${Translations[this.currentLanguage].report || 'Report'} (${periodText})`, 20, 20);
            doc.setFontSize(10);
            doc.text(`${Translations[this.currentLanguage].user_label || 'User'}: ${DataManager.currentUser || 'Unknown'}`, 20, 30);
            doc.text(`${Translations[this.currentLanguage].currency || 'Currency'}: ${this.currentCurrency || 'KGS'}`, 20, 36);
            doc.text(`${Translations[this.currentLanguage].generated || 'Generated'}: ${new Date().toLocaleString(this.currentLanguage)}`, 20, 42);
    
            // Итоговые суммы
            let y = 52;
            doc.setFontSize(12);
            doc.text(Translations[this.currentLanguage].summary || 'Summary', 20, y);
            y += 8;
            doc.setFontSize(10);
            const summary = [
                `${Translations[this.currentLanguage].purchases || 'Purchases'}: ${this.convertToCurrentCurrency(totals.purchasesTotal || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].sales || 'Sales'}: ${this.convertToCurrentCurrency(totals.salesTotal || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].expenses || 'Expenses'}: ${this.convertToCurrentCurrency(totals.expensesTotal || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].salaries || 'Salaries'}: ${this.convertToCurrentCurrency(totals.salariesGross || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].tax || 'Tax'}: ${this.convertToCurrentCurrency(totals.taxTotal || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].social || 'Social'}: ${this.convertToCurrentCurrency(totals.socialTotal || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].vat || 'VAT'}: ${this.convertToCurrentCurrency(totals.vatTotal || 0)} ${this.currentCurrency}`,
                `${Translations[this.currentLanguage].profit || 'Profit'}: ${this.convertToCurrentCurrency(totals.profit || 0)} ${this.currentCurrency}${totals.profit < 0 ? ` (${Translations[this.currentLanguage].negative || 'Negative'})` : ''}`
            ];
            summary.forEach(line => {
                if (y > 270) { doc.addPage(); y = 20; }
                doc.text(line, 20, y);
                y += 6;
            });
    
            // Закупки
            y += 10;
            if (y > 260) { doc.addPage(); y = 20; }
            doc.setFontSize(12);
            doc.text(Translations[this.currentLanguage].purchases || 'Purchases', 20, y);
            y += 8;
            doc.setFontSize(10);
            if (filteredPurchases.length) {
                doc.text(`${Translations[this.currentLanguage].date || 'Date'} | ${Translations[this.currentLanguage].category || 'Category'} | ${Translations[this.currentLanguage].item_name || 'Item'} | ${Translations[this.currentLanguage].quantity || 'Qty'} | ${Translations[this.currentLanguage].cost || 'Cost'} | ${Translations[this.currentLanguage].description || 'Description'}`, 20, y);
                y += 6;
                filteredPurchases.forEach(p => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    const line = `${p.date || '-'} | ${p.category || '-'} | ${p.item || '-'} | ${p.quantity || 0} | ${this.convertToCurrentCurrency(p.cost || 0)} ${this.currentCurrency} | ${p.description || '-'}`;
                    splitText(line, 170).forEach(splitLine => {
                        doc.text(splitLine, 20, y);
                        y += 6;
                    });
                });
            } else {
                doc.text(Translations[this.currentLanguage].no_data || 'No data', 20, y);
                y += 6;
            }
    
            // Продажи
            y += 10;
            if (y > 260) { doc.addPage(); y = 20; }
            doc.setFontSize(12);
            doc.text(Translations[this.currentLanguage].sales || 'Sales', 20, y);
            y += 8;
            doc.setFontSize(10);
            if (filteredSales.length) {
                doc.text(`${Translations[this.currentLanguage].date || 'Date'} | ${Translations[this.currentLanguage].category || 'Category'} | ${Translations[this.currentLanguage].item_name || 'Item'} | ${Translations[this.currentLanguage].quantity || 'Qty'} | ${Translations[this.currentLanguage].cost || 'Cost'} | ${Translations[this.currentLanguage].vat || 'VAT'} | ${Translations[this.currentLanguage].comment || 'Comment'}`, 20, y);
                y += 6;
                filteredSales.forEach(s => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    const line = `${s.date || '-'} | ${s.category || '-'} | ${s.item || '-'} | ${s.quantity || 0} | ${this.convertToCurrentCurrency(s.amount || 0)} ${this.currentCurrency} | ${this.convertToCurrentCurrency(s.vat || 0)} ${this.currentCurrency} | ${s.comment || '-'}`;
                    splitText(line, 170).forEach(splitLine => {
                        doc.text(splitLine, 20, y);
                        y += 6;
                    });
                });
            } else {
                doc.text(Translations[this.currentLanguage].no_data || 'No data', 20, y);
                y += 6;
            }
    
            // Расходы
            y += 10;
            if (y > 260) { doc.addPage(); y = 20; }
            doc.setFontSize(12);
            doc.text(Translations[this.currentLanguage].expenses || 'Expenses', 20, y);
            y += 8;
            doc.setFontSize(10);
            if (filteredExpenses.length) {
                doc.text(`${Translations[this.currentLanguage].date || 'Date'} | ${Translations[this.currentLanguage].type || 'Type'} | ${Translations[this.currentLanguage].cost || 'Cost'} | ${Translations[this.currentLanguage].description || 'Description'}`, 20, y);
                y += 6;
                filteredExpenses.forEach(e => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    const line = `${e.date || '-'} | ${Translations[this.currentLanguage][e.type] || e.type || '-'} | ${this.convertToCurrentCurrency(e.cost || 0)} ${this.currentCurrency} | ${e.description || '-'}`;
                    splitText(line, 170).forEach(splitLine => {
                        doc.text(splitLine, 20, y);
                        y += 6;
                    });
                });
            } else {
                doc.text(Translations[this.currentLanguage].no_data || 'No data', 20, y);
                y += 6;
            }
    
            // Зарплаты
            y += 10;
            if (y > 260) { doc.addPage(); y = 20; }
            doc.setFontSize(12);
            doc.text(Translations[this.currentLanguage].salaries || 'Salaries', 20, y);
            y += 8;
            doc.setFontSize(10);
            if (filteredSalaries.length) {
                doc.text(`${Translations[this.currentLanguage].date || 'Date'} | ${Translations[this.currentLanguage].worker_name || 'Name'} | ${Translations[this.currentLanguage].role || 'Role'} | ${Translations[this.currentLanguage].gross_salary || 'Gross'} | ${Translations[this.currentLanguage].tax || 'Tax'} | ${Translations[this.currentLanguage].social || 'Social'} | ${Translations[this.currentLanguage].net_salary || 'Net'}`, 20, y);
                y += 6;
                filteredSalaries.forEach(s => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    const line = `${s.date ? new Date(s.date).toLocaleDateString(this.currentLanguage) : '-'} | ${s.name || '-'} | ${s.role || '-'} | ${this.convertToCurrentCurrency(s.grossSalary || 0)} ${this.currentCurrency} | ${this.convertToCurrentCurrency(s.tax || 0)} ${this.currentCurrency} | ${this.convertToCurrentCurrency(s.social || 0)} ${this.currentCurrency} | ${this.convertToCurrentCurrency(s.netSalary || 0)} ${this.currentCurrency}`;
                    splitText(line, 170).forEach(splitLine => {
                        doc.text(splitLine, 20, y);
                        y += 6;
                    });
                });
            } else {
                doc.text(Translations[this.currentLanguage].no_data || 'No data', 20, y);
                y += 6;
            }
    
            // Задачи сотрудников
            y += 10;
            if (y > 260) { doc.addPage(); y = 20; }
            doc.setFontSize(12);
            doc.text(Translations[this.currentLanguage].worker_tasks || 'Worker Tasks', 20, y);
            y += 8;
            doc.setFontSize(10);
            if (filteredTasks.length) {
                doc.text(`${Translations[this.currentLanguage].date || 'Date'} | ${Translations[this.currentLanguage].task_type || 'Task Type'} | ${Translations[this.currentLanguage].clothing_type || 'Clothing'} | ${Translations[this.currentLanguage].part_type || 'Part'} | ${Translations[this.currentLanguage].quantity || 'Qty'} | ${Translations[this.currentLanguage].total_amount || 'Total'} | ${Translations[this.currentLanguage].worker || 'Worker'}`, 20, y);
                y += 6;
                filteredTasks.forEach(t => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    const worker = data.workers ? data.workers.find(w => w.id === t.workerId) : null;
                    const line = `${t.date || '-'} | ${t.taskType || '-'} | ${t.clothingType || '-'} | ${t.partType || '-'} | ${t.quantity || 0} | ${this.convertToCurrentCurrency(t.total || 0)} ${this.currentCurrency} | ${worker ? worker.name : Translations[this.currentLanguage].unknown || 'Unknown'}`;
                    splitText(line, 170).forEach(splitLine => {
                        doc.text(splitLine, 20, y);
                        y += 6;
                    });
                });
            } else {
                doc.text(Translations[this.currentLanguage].no_data || 'No data', 20, y);
                y += 6;
            }
    
            doc.save(`report_${new Date().toISOString().split('T')[0]}.pdf`);
            this.showNotification(Translations[this.currentLanguage].pdf_downloaded || 'PDF downloaded', 'success');
        } catch (e) {
            console.error('Ошибка при создании PDF:', e.message, e.stack);
            this.showNotification(Translations[this.currentLanguage].pdf_error || 'Ошибка при скачивании PDF', 'error');
        }
        this.showLoading(false);
    },
    
    downloadExcel: function() {
        try {
            if (!window.XLSX || !XLSX.utils || !XLSX.write) {
                throw new Error('Библиотека XLSX не загружена');
            }
    
            const data = DataManager.getUserData();
            if (!data) {
                throw new Error('Данные пользователя недоступны');
            }
    
            const dateFilter = document.getElementById('dateFilter').value || this.globalFilter.value;
            const filterType = this.globalFilter.type;
            const totals = this.calculateTotals(filterType, dateFilter);
            if (!totals) {
                throw new Error('Итоговые суммы недоступны');
            }
    
            const filteredPurchases = this.filterItemsByDate(data.purchases || [], filterType, dateFilter);
            const filteredSales = this.filterItemsByDate(data.sales || [], filterType, dateFilter);
            const filteredExpenses = this.filterItemsByDate(data.expenses || [], filterType, dateFilter);
            const filteredSalaries = this.filterItemsByDate(data.salaries || [], filterType, dateFilter);
            const filteredTasks = this.filterItemsByDate(data.tasks || [], filterType, dateFilter);
    
            // Форматирование периода
            let periodText = Translations[this.currentLanguage].all_time || 'All time';
            try {
                if (filterType === 'day' && dateFilter) {
                    periodText = new Date(dateFilter).toLocaleDateString(this.currentLanguage);
                } else if (filterType === 'month' && dateFilter) {
                    const [year, month] = dateFilter.split('-');
                    periodText = `${Translations[this.currentLanguage][`month_${parseInt(month) - 1}`] || month} ${year}`;
                } else if (filterType === 'year' && dateFilter) {
                    periodText = dateFilter;
                }
            } catch (e) {
                console.error('Ошибка форматирования периода:', e);
            }
    
            // Создание книги Excel
            const wb = XLSX.utils.book_new();
            if (!wb) {
                throw new Error('Не удалось создать книгу Excel');
            }
    
            // Лист 1: Общий итог
            const summaryData = [
                [`${Translations[this.currentLanguage].report || 'Report'} (${periodText})`],
                [Translations[this.currentLanguage].user_label || 'User', DataManager.currentUser || 'Unknown'],
                [Translations[this.currentLanguage].currency || 'Currency', this.currentCurrency || 'KGS'],
                [Translations[this.currentLanguage].generated || 'Generated', new Date().toLocaleString(this.currentLanguage)],
                [],
                [Translations[this.currentLanguage].summary || 'Summary'],
                [Translations[this.currentLanguage].purchases || 'Purchases', `${this.convertToCurrentCurrency(totals.purchasesTotal || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].sales || 'Sales', `${this.convertToCurrentCurrency(totals.salesTotal || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].expenses || 'Expenses', `${this.convertToCurrentCurrency(totals.expensesTotal || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].salaries || 'Salaries', `${this.convertToCurrentCurrency(totals.salariesGross || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].tax || 'Tax', `${this.convertToCurrentCurrency(totals.taxTotal || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].social || 'Social', `${this.convertToCurrentCurrency(totals.socialTotal || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].vat || 'VAT', `${this.convertToCurrentCurrency(totals.vatTotal || 0)} ${this.currentCurrency}`],
                [Translations[this.currentLanguage].profit || 'Profit', `${this.convertToCurrentCurrency(totals.profit || 0)} ${this.currentCurrency}${totals.profit < 0 ? ` (${Translations[this.currentLanguage].negative || 'Negative'})` : ''}`]
            ];
            const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
            XLSX.utils.book_append_sheet(wb, wsSummary, Translations[this.currentLanguage].summary || 'Summary');
    
            // Лист 2: Закупки
            const purchasesData = [
                [
                    Translations[this.currentLanguage].date || 'Date',
                    Translations[this.currentLanguage].category || 'Category',
                    Translations[this.currentLanguage].item_name || 'Item',
                    Translations[this.currentLanguage].quantity || 'Qty',
                    Translations[this.currentLanguage].cost || 'Cost',
                    Translations[this.currentLanguage].description || 'Description'
                ],
                ...filteredPurchases.map(p => [
                    p.date || '-',
                    p.category || '-',
                    p.item || '-',
                    p.quantity || 0,
                    `${this.convertToCurrentCurrency(p.cost || 0)} ${this.currentCurrency}`,
                    p.description || '-'
                ])
            ];
            const wsPurchases = XLSX.utils.aoa_to_sheet(purchasesData);
            XLSX.utils.book_append_sheet(wb, wsPurchases, Translations[this.currentLanguage].purchases || 'Purchases');
    
            // Лист 3: Продажи
            const salesData = [
                [
                    Translations[this.currentLanguage].date || 'Date',
                    Translations[this.currentLanguage].category || 'Category',
                    Translations[this.currentLanguage].item_name || 'Item',
                    Translations[this.currentLanguage].quantity || 'Qty',
                    Translations[this.currentLanguage].cost || 'Cost',
                    Translations[this.currentLanguage].vat || 'VAT',
                    Translations[this.currentLanguage].comment || 'Comment'
                ],
                ...filteredSales.map(s => [
                    s.date || '-',
                    s.category || '-',
                    s.item || '-',
                    s.quantity || 0,
                    `${this.convertToCurrentCurrency(s.amount || 0)} ${this.currentCurrency}`,
                    `${this.convertToCurrentCurrency(s.vat || 0)} ${this.currentCurrency}`,
                    s.comment || '-'
                ])
            ];
            const wsSales = XLSX.utils.aoa_to_sheet(salesData);
            XLSX.utils.book_append_sheet(wb, wsSales, Translations[this.currentLanguage].sales || 'Sales');
    
            // Лист 4: Расходы
            const expensesData = [
                [
                    Translations[this.currentLanguage].date || 'Date',
                    Translations[this.currentLanguage].type || 'Type',
                    Translations[this.currentLanguage].cost || 'Cost',
                    Translations[this.currentLanguage].description || 'Description'
                ],
                ...filteredExpenses.map(e => [
                    e.date || '-',
                    Translations[this.currentLanguage][e.type] || e.type || '-',
                    `${this.convertToCurrentCurrency(e.cost || 0)} ${this.currentCurrency}`,
                    e.description || '-'
                ])
            ];
            const wsExpenses = XLSX.utils.aoa_to_sheet(expensesData);
            XLSX.utils.book_append_sheet(wb, wsExpenses, Translations[this.currentLanguage].expenses || 'Expenses');
    
            // Лист 5: Зарплаты
            const salariesData = [
                [
                    Translations[this.currentLanguage].date || 'Date',
                    Translations[this.currentLanguage].worker_name || 'Name',
                    Translations[this.currentLanguage].role || 'Role',
                    Translations[this.currentLanguage].gross_salary || 'Gross',
                    Translations[this.currentLanguage].tax || 'Tax',
                    Translations[this.currentLanguage].social || 'Social',
                    Translations[this.currentLanguage].net_salary || 'Net'
                ],
                ...filteredSalaries.map(s => [
                    s.date ? new Date(s.date).toLocaleDateString(this.currentLanguage) : '-',
                    s.name || '-',
                    s.role || '-',
                    `${this.convertToCurrentCurrency(s.grossSalary || 0)} ${this.currentCurrency}`,
                    `${this.convertToCurrentCurrency(s.tax || 0)} ${this.currentCurrency}`,
                    `${this.convertToCurrentCurrency(s.social || 0)} ${this.currentCurrency}`,
                    `${this.convertToCurrentCurrency(s.netSalary || 0)} ${this.currentCurrency}`
                ])
            ];
            const wsSalaries = XLSX.utils.aoa_to_sheet(salariesData);
            XLSX.utils.book_append_sheet(wb, wsSalaries, Translations[this.currentLanguage].salaries || 'Salaries');
    
            // Лист 6: Задачи сотрудников
            const tasksData = [
                [
                    Translations[this.currentLanguage].date || 'Date',
                    Translations[this.currentLanguage].task_type || 'Task Type',
                    Translations[this.currentLanguage].clothing_type || 'Clothing',
                    Translations[this.currentLanguage].part_type || 'Part',
                    Translations[this.currentLanguage].quantity || 'Qty',
                    Translations[this.currentLanguage].total_amount || 'Total',
                    Translations[this.currentLanguage].worker || 'Worker'
                ],
                ...filteredTasks.map(t => {
                    const worker = data.workers ? data.workers.find(w => w.id === t.workerId) : null;
                    return [
                        t.date || '-',
                        t.taskType || '-',
                        t.clothingType || '-',
                        t.partType || '-',
                        t.quantity || 0,
                        `${this.convertToCurrentCurrency(t.total || 0)} ${this.currentCurrency}`,
                        worker ? worker.name : Translations[this.currentLanguage].unknown || 'Unknown'
                    ];
                })
            ];
            const wsTasks = XLSX.utils.aoa_to_sheet(tasksData);
            XLSX.utils.book_append_sheet(wb, wsTasks, Translations[this.currentLanguage].worker_tasks || 'Worker Tasks');
    
            // Сохранение файла
            XLSX.write(wb, `report_${new Date().toISOString().split('T')[0]}.xlsx`);
            this.showNotification(Translations[this.currentLanguage].excel_downloaded || 'Excel downloaded', 'success');
        } catch (e) {
            console.error('Ошибка при создании Excel:', e.message, e.stack);
            this.showNotification(Translations[this.currentLanguage].excel_error || 'Ошибка при скачивании Excel', 'error');
        }
    },
    
    clearData() {
        if (confirm(Translations[this.currentLanguage].confirm_clear)) {
            const userData = DataManager.getUserData();
            userData.purchases = [];
            userData.sales = [];
            userData.salaries = [];
            userData.expenses = [];
            userData.workers = [];
            userData.tasks = [];
            userData.history = [];
            DataManager.saveData();
            this.updateAllLists();
            this.generateReport();
            this.updateAnalytics();
            this.showNotification(Translations[this.currentLanguage].data_cleared, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        }
    },
    
    populateAnalyticsYears() {
        const data = DataManager.getUserData();
        const years = new Set();
        [...data.purchases, ...data.sales, ...data.expenses, ...data.salaries].forEach(item => {
            if (item.date) years.add(new Date(item.date).getFullYear());
        });
        const yearSelect = document.getElementById('analyticsYear');
        const dashboardYearSelect = document.getElementById('dashboardFilterYear');
        const salaryYearSelect = document.getElementById('salaryFilterYear');
        const currentYear = new Date().getFullYear();
        years.add(currentYear);
        const sortedYears = Array.from(years).sort((a, b) => b - a);
        const yearOptions = sortedYears.map(year => `<option value="${year}">${year}</option>`).join('');
        if (yearSelect) yearSelect.innerHTML = yearOptions;
        if (dashboardYearSelect) dashboardYearSelect.innerHTML = yearOptions;
        if (salaryYearSelect) salaryYearSelect.innerHTML = yearOptions;
        if (sortedYears.length > 0) {
            const latestYear = sortedYears[0];
            if (yearSelect) yearSelect.value = latestYear;
            if (dashboardYearSelect) dashboardYearSelect.value = latestYear;
            if (salaryYearSelect) salaryYearSelect.value = latestYear;
            this.updateAnalytics();
            this.updateDashboard();
            this.updateSalaryList();
        }
    },
    
    populateFilterYears() {
        const data = DataManager.getUserData();
        const years = new Set();
        [...data.purchases, ...data.sales, ...data.expenses, ...data.salaries].forEach(item => {
            if (item.date) years.add(new Date(item.date).getFullYear());
        });
        const yearSelect = document.getElementById('dateFilterYear');
        const currentYear = new Date().getFullYear();
        years.add(currentYear);
        const sortedYears = Array.from(years).sort((a, b) => b - a);
        yearSelect.innerHTML = sortedYears.map(year => `<option value="${year}">${year}</option>`).join('');
        if (sortedYears.length > 0) {
            yearSelect.value = sortedYears[0];
        }
    },
    
    updateFilterInputs() {
        const filterType = document.getElementById('filterType').value;
        document.getElementById('dateFilterDay').style.display = filterType === 'day' ? 'block' : 'none';
        document.getElementById('dateFilterMonth').style.display = filterType === 'month' ? 'block' : 'none';
        document.getElementById('dateFilterYear').style.display = filterType === 'month' || filterType === 'year' ? 'block' : 'none';
    },
    
    applyGlobalFilter() {
        const filterType = document.getElementById('filterType').value;
        const filterValue = filterType === 'day' ? document.getElementById('dateFilterDay').value :
                            filterType === 'month' ? `${document.getElementById('dateFilterYear').value}-${document.getElementById('dateFilterMonth').value}` :
                            document.getElementById('dateFilterYear').value;
        this.globalFilter = { type: filterType, value: filterValue };
        this.updateAllLists();
        this.generateReport();
        this.updateAnalytics();
        this.updateDashboard();
        this.showNotification(Translations[this.currentLanguage].filter_applied, 'success');
    },
    
    updateAnalytics() {
        const filterType = document.getElementById('analyticsFilterType')?.value || 'month';
        const year = document.getElementById('analyticsYear')?.value;
        const month = document.getElementById('analyticsMonth')?.value;
        const category = document.getElementById('analyticsCategory')?.value || 'all';
        const data = DataManager.getUserData();
        const datasets = [];
    
        const filterItems = (items) => {
            if (filterType === 'all') return items;
            return items.filter(item => {
                const itemDate = new Date(item.date);
                if (filterType === 'month') {
                    return itemDate.getFullYear() == year && itemDate.getMonth() == month;
                } else if (filterType === 'year') {
                    return itemDate.getFullYear() == year;
                }
                return true;
            });
        };
    
        const categories = category === 'all' ? ['purchases', 'sales', 'expenses', 'salaries', 'tax', 'social', 'vat', 'profit'] : [category];
        const colors = {
            purchases: '#f87171',
            sales: '#34d399',
            expenses: '#facc15',
            salaries: '#60a5fa',
            tax: '#ef4444',
            social: '#f59e0b',
            vat: '#3b82f6',
            profit: '#10b981'
        };
    
        let labels = [];
        if (filterType === 'month') {
            labels = [Translations[this.currentLanguage][`month_${parseInt(month)}`]];
        } else if (filterType === 'year') {
            labels = [
                Translations[this.currentLanguage].jan,
                Translations[this.currentLanguage].feb,
                Translations[this.currentLanguage].mar,
                Translations[this.currentLanguage].apr,
                Translations[this.currentLanguage].may,
                Translations[this.currentLanguage].jun,
                Translations[this.currentLanguage].jul,
                Translations[this.currentLanguage].aug,
                Translations[this.currentLanguage].sep,
                Translations[this.currentLanguage].oct,
                Translations[this.currentLanguage].nov,
                Translations[this.currentLanguage].dec
            ];
        } else if (filterType === 'all') {
            const years = new Set();
            [...data.purchases, ...data.sales, ...data.expenses, ...data.salaries].forEach(item => {
                if (item.date) years.add(new Date(item.date).getFullYear());
            });
            labels = Array.from(years).sort((a, b) => a - b).map(year => `${year}`);
        }
    
        categories.forEach(cat => {
            const catData = filterType === 'month' ? [0] : filterType === 'year' ? Array(12).fill(0) : Array(labels.length).fill(0);
            if (cat === 'purchases') {
                filterItems(data.purchases).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.cost / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'sales') {
                filterItems(data.sales).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.amount / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'expenses') {
                filterItems(data.expenses).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.cost / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'salaries') {
                filterItems(data.salaries).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.grossSalary / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'tax') {
                filterItems(data.salaries).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.tax / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'social') {
                filterItems(data.salaries).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.social / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'vat') {
                filterItems(data.sales).forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.vat / DataManager.exchangeRates[this.currentCurrency];
                });
            } else if (cat === 'profit') {
                const sales = filterItems(data.sales);
                const purchases = filterItems(data.purchases);
                const expenses = filterItems(data.expenses);
                const salaries = filterItems(data.salaries);
                sales.forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] += item.amount;
                });
                purchases.forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] -= item.cost;
                });
                expenses.forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] -= item.cost;
                });
                salaries.forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] -= (item.grossSalary + item.tax + item.social);
                });
                sales.forEach(item => {
                    const date = new Date(item.date);
                    const index = filterType === 'month' ? 0 : filterType === 'year' ? date.getMonth() : labels.indexOf(`${date.getFullYear()}`);
                    if (index >= 0) catData[index] -= item.vat;
                });
            }
            datasets.push({
                label: Translations[this.currentLanguage][cat],
                data: catData.map(v => parseFloat(this.convertToCurrentCurrency(v))),
                borderColor: colors[cat],
                backgroundColor: `${colors[cat]}33`,
                fill: category === 'all' ? false : true,
                tension: 0.4
            });
        });
    
        if (this.analyticsChart) {
            this.analyticsChart.destroy();
        }
        const ctx = document.getElementById('analyticsChart').getContext('2d');
        this.analyticsChart = new Chart(ctx, {
            type: category === 'all' ? 'line' : 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                animation: { duration: 1000, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: category === 'all', labels: { color: document.body.classList.contains('dark') ? '#e2e8f0' : '#1a202c' } },
                    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw} ${this.currentCurrency}` } }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => `${v} ${this.currentCurrency}` } }
                }
            }
        });
    },

    updateAnalyticsFilterInputs() {
        const filterType = document.getElementById('analyticsFilterType')?.value || 'month';
        const yearFilter = document.getElementById('analyticsYear');
        const monthFilter = document.getElementById('analyticsMonth');
    
        if (yearFilter && monthFilter) {
            if (filterType === 'month') {
                yearFilter.classList.remove('hidden');
                monthFilter.classList.remove('hidden');
            } else if (filterType === 'year') {
                yearFilter.classList.remove('hidden');
                monthFilter.classList.add('hidden');
            } else if (filterType === 'all') {
                yearFilter.classList.add('hidden');
                monthFilter.classList.add('hidden');
            }
            this.updateAnalytics(); // Обновляем аналитику при изменении типа фильтра
        }
    },
    
    showRegisterForm() {
        this.closeModal('authModal');
        this.showModal('registerModal');
    },
    
    showPasswordModal() {
        this.closeModal('authModal');
        this.showModal('passwordModal');
    },
    
    registerUser() {
        const username = document.getElementById('registerUsername').value.trim();
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        try {
            if (password !== confirmPassword) {
                throw new Error(Translations[this.currentLanguage].register_password_mismatch);
            }
            DataManager.registerUser(username, password);
            this.closeModal('registerModal');
            this.showModal('authModal');
            this.showNotification(Translations[this.currentLanguage].register_success, 'success');
        } catch (e) {
            this.showNotification(e.message, 'error');
        }
    },
    
    changePassword() {
        const username = document.getElementById('changeUsername').value.trim();
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        if (DataManager.users[username] && DataManager.users[username].password === oldPassword) {
            if (newPassword.length < 5) {
                this.showNotification(Translations[this.currentLanguage].register_password_short, 'error');
                return;
            }
            DataManager.users[username].password = newPassword;
            DataManager.saveData();
            DataManager.logAction('change_password', { username });
            this.closeModal('passwordModal');
            this.showModal('authModal');
            this.showNotification(Translations[this.currentLanguage].password_changed, 'success');
        } else {
            this.showNotification(Translations[this.currentLanguage].password_error, 'error');
        }
    },
    
    showImportModal() {
        this.showModal('importModal');
    },
    
    importData() {
        const fileInput = document.getElementById('importFile');
        if (fileInput.files.length > 0) {
            this.showLoading(true);
            DataManager.importData(fileInput.files[0])
                .then(() => {
                    this.updateAllLists();
                    this.generateReport();
                    this.updateAnalytics();
                    this.closeModal('importModal');
                    this.showNotification(Translations[this.currentLanguage].import_success, 'success');
                    this.showLoading(false);
                    this.populateAnalyticsYears();
                    this.populateFilterYears();
                })
                .catch(e => {
                    this.showNotification(e.message, 'error');
                    this.showLoading(false);
                });
        }
    },
    
    exportData() {
        DataManager.exportData();
        this.showNotification(Translations[this.currentLanguage].export_success, 'success');
    },
    
    async scanReceipt() {
        this.showModal('scanReceiptModal');
        document.getElementById('startScanBtn').style.display = 'block';
        document.getElementById('captureBtn').style.display = 'none';
        document.getElementById('processBtn').style.display = 'none';
        document.getElementById('receiptImage').style.display = 'none';
    },
    
    async startScan() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            const video = document.getElementById('video');
            video.srcObject = stream;
            video.style.display = 'block';
            video.play();
            document.getElementById('startScanBtn').style.display = 'none';
            document.getElementById('captureBtn').style.display = 'block';
        } catch (e) {
            this.showNotification(Translations[this.currentLanguage].scan_error, 'error');
        }
    },
    
    captureImage() {
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const receiptImage = document.getElementById('receiptImage');
        receiptImage.src = canvas.toDataURL('image/jpeg');
        receiptImage.style.display = 'block';
        video.style.display = 'none';
        document.getElementById('captureBtn').style.display = 'none';
        document.getElementById('processBtn').style.display = 'block';
        video.srcObject.getTracks().forEach(track => track.stop());
    },
    
    processReceipt() {
        const receiptImage = document.getElementById('receiptImage');
        const canvas = document.getElementById('canvas');
        const img = new Image();
        img.src = receiptImage.src;
        img.onload = () => {
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const cost = Math.floor(Math.random() * 1000) + 100;
            const expense = {
                type: 'other',
                cost: cost * DataManager.exchangeRates[this.currentCurrency],
                description: Translations[this.currentLanguage].scanned_receipt,
                date: new Date().toISOString().split('T')[0]
            };
            const data = DataManager.getUserData();
            data.expenses = data.expenses || [];
            data.expenses.push(expense);
            DataManager.logAction('add_scanned_expense', expense);
            this.updateExpenseList(this.filterItemsByDate(data.expenses, this.globalFilter.type, this.globalFilter.value));
            DataManager.saveData();
            this.closeModal('scanReceiptModal');
            this.showNotification(Translations[this.currentLanguage].receipt_processed, 'success');
            this.populateAnalyticsYears();
            this.populateFilterYears();
        };
    },
    
    togglePassword(inputId) {
        const input = document.getElementById(inputId);
        const icon = input.nextElementSibling;
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    },
    
    installApp() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            this.deferredPrompt.userChoice.then(choiceResult => {
                if (choiceResult.outcome === 'accepted') {
                    this.showNotification(Translations[this.currentLanguage].app_installed, 'success');
                }
                this.deferredPrompt = null;
            });
        }
    }
};

// Импорты для Firestore
import { collection, addDoc, getDocs, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Инициализация DataManager
DataManager.init(db);

// Глобальные функции
async function login() {
    await UIManager.login();
}

async function logout() {
    await UIManager.logout();
}

async function registerUser() {
    await UIManager.registerUser();
}

function toggleTheme() {
    UIManager.toggleTheme();
}

function updateCurrency() {
    UIManager.updateCurrency();
}

function openTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
    if (tabName === 'report') {
        UIManager.generateReport();
    } else if (tabName === 'analytics') {
        UIManager.updateAnalytics();
    } else if (tabName === 'dashboard') {
        UIManager.updateDashboard();
    } else if (tabName === 'salaries') {
        UIManager.updateSalaryList();
    }
}

function addPurchase() {
    UIManager.addPurchase();
}

function addSale() {
    UIManager.addSale();
}

function addWorker() {
    UIManager.addWorker();
}

function addWorkerTask() {
    UIManager.addWorkerTask();
}

function addElectricity() {
    UIManager.addElectricity();
}

function addRepair() {
    UIManager.addRepair();
}

function addRent() {
    UIManager.addRent();
}

function addTransport() {
    UIManager.addTransport();
}

function refreshData() {
    UIManager.refreshData();
}

function showRegisterForm() {
    UIManager.showRegisterForm();
}

function showPasswordModal() {
    UIManager.showPasswordModal();
}

function registerUser() {
    UIManager.registerUser();
}

function changePassword() {
    UIManager.changePassword();
}

function generateReport() {
    UIManager.generateReport();
}

function downloadPDF() {
    UIManager.downloadPDF();
}

function downloadExcel() {
    UIManager.downloadExcel();
}

function clearData() {
    UIManager.clearData();
}

function updateAnalytics() {
    UIManager.updateAnalytics();
}

document.addEventListener('DOMContentLoaded', () => {
    if (DataManager.currentUser) {
        UIManager.showMainInterface();
        UIManager.loadData();
    } else {
        UIManager.showModal('authModal');
    }
    UIManager.changeLanguage();

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('Service Worker зарегистрирован:', registration);
                })
                .catch(error => {
                    console.error('Ошибка регистрации Service Worker:', error);
                });
        });
    }
});