// Ensure the DOM is fully loaded before initializing
document.addEventListener('DOMContentLoaded', function() {

    checkAndDeleteExpiredOrders();
    initializeDB()
        .then(() => {  
            console.log("IndexedDB initialized");
            initializeUI();
            loadPendingOrders(); // This will now also load archived orders
            startSyncCycle();
            
// Call this after loading orders
checkPendingOrdersForExpiry();
        })
        .catch(error => console.error("Error initializing IndexedDB:", error));
});
// IndexedDB setup
let db;
const DB_NAME = 'PendingOrdersDB';
const STORE_NAME = 'orders';

function initializeDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onerror = (event) => reject("IndexedDB error: " + event.target.error);
        
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            objectStore.createIndex("status", "status", { unique: false });
            objectStore.createIndex("partyName", "partyName", { unique: false });
        };
    });
}

function saveOrdersToIndexedDB(orders) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database not initialized"));
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);
        
        // Ensure each order has an ID
        orders.forEach(order => {
            if (!order.id) {
                console.error("Order missing ID:", order);
                reject(new Error("Order missing ID property"));
                return;
            }
            objectStore.put(order);
        });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
    });
}
let lastSyncTime = 0;
const SYNC_INTERVAL = 15 * 60 * 1000; // 5 minutes in milliseconds

function initializeUI() {
    // ... (existing code)

    // Initial sync
    syncWithFirebase();

    // Set up realtime listener for new pending orders
    setupRealtimeListener();
}

function checkPendingOrdersForExpiry() {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + (10 * 24 * 60 * 60 * 1000)); // 10 days before expiry
    const criticalThreshold = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000)); // 5 days before expiry
    
    getOrdersFromIndexedDB()
        .then(orders => {
            orders.forEach(order => {
                if (order.expiryDate) {
                    const expiryDate = new Date(order.expiryDate);
                    const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
                    
                    const orderElement = document.querySelector(`[data-order-id="${order.id}"]`);
                    if (orderElement) {
                        // Remove existing classes
                        orderElement.classList.remove(
                            'expiry-normal', 'expiry-warning', 'expiry-critical', 'expiry-expired'
                        );
                        
                        // Add appropriate class
                        if (expiryDate <= now) {
                            orderElement.classList.add('expiry-expired');
                        } else if (expiryDate <= criticalThreshold) {
                            orderElement.classList.add('expiry-critical');
                        } else if (expiryDate <= warningThreshold) {
                            orderElement.classList.add('expiry-warning');
                        } else {
                            orderElement.classList.add('expiry-normal');
                        }
                        
                        // Add tooltip
                        orderElement.setAttribute('data-bs-toggle', 'tooltip');
                        orderElement.setAttribute('title', 
                            `Expires in ${daysRemaining} days (${expiryDate.toLocaleDateString()})`);
                    }
                }
            });
            // Initialize tooltips
            $('[data-bs-toggle="tooltip"]').tooltip();
        });
}

function syncWithFirebase() {
    const now = Date.now();
    if (now - lastSyncTime < SYNC_INTERVAL) {
        console.log("Sync skipped: Too soon since last sync");
        return Promise.resolve();
    }

    console.log("Syncing with Firebase...");
    lastSyncTime = now;

    return fetchOrdersFromFirebase()
        .then(firebaseOrders => {
            return updateIndexedDB(firebaseOrders);
        })
        .then(() => {
            console.log("Sync complete");
            loadPendingOrders(); // Reload the UI after sync
        })
        .catch(error => {
            console.error("Sync error:", error);
            lastSyncTime = 0; // Reset last sync time on error to allow immediate retry
        });
}

function setupRealtimeListener() {
    const ordersRef = firebase.database().ref('orders');
    ordersRef.on('child_added', (snapshot) => {
        const newOrder = snapshot.val();
        if (newOrder.status === 'Pending') {
            console.log("New pending order detected, requesting sync...");
            requestSync();
        }
    });
}

function requestSync() {
    const now = Date.now();
    if (now - lastSyncTime >= SYNC_INTERVAL) {
        syncWithFirebase();
    } else {
        const timeToNextSync = SYNC_INTERVAL - (now - lastSyncTime);
        console.log(`Sync requested, but it's too soon. Next sync in ${timeToNextSync / 1000} seconds`);
    }
}

// Call this function when the page loads or when you want to start the sync cycle
function startSyncCycle() {
    syncWithFirebase(); // Initial sync
    setInterval(requestSync, SYNC_INTERVAL); // Set up interval for future syncs
}

// Call startSyncCycle when your app initializes
document.addEventListener('DOMContentLoaded', function() {
    initializeDB()
        .then(() => {
            console.log("IndexedDB initialized");
            initializeUI();
            startSyncCycle();
        })
        .catch(error => console.error("Error initializing IndexedDB:", error));
});


function updateIndexedDB(firebaseOrders) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database not initialized"));
            return;
        }
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);

        // Clear existing data
        objectStore.clear();

        // Add new data
        firebaseOrders.forEach(order => {
            objectStore.add(order);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = event => reject(event.target.error);
    });
}





function getOrdersFromIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database not initialized"));
            return;
        }
        const transaction = db.transaction([STORE_NAME], "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);
        const index = objectStore.index("status");
        const request = index.getAll("Pending");
        
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

function initializeUI() {
    const filterButton = document.getElementById('filterButton');
    const filterModal = document.getElementById('filterModal4');
    const closeBtn = filterModal.querySelector('.close4');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');
    const saveFilterBtn = document.getElementById('saveFilterBtn');
    const clearFiltersButton = document.getElementById('clearFiltersButton');
    const viewToggle = document.getElementById('viewToggle');

    filterButton.addEventListener('click', openFilterModal);
    closeBtn.addEventListener('click', () => closeFilterModal(false));
    selectAllBtn.addEventListener('click', selectAllPartyNames);
    deselectAllBtn.addEventListener('click', deselectAllPartyNames);
    saveFilterBtn.addEventListener('click', applyFilters);
    clearFiltersButton.addEventListener('click', clearFilters);
    viewToggle.addEventListener('change', handleViewToggle);

    window.addEventListener('click', function(event) {
        if (event.target == filterModal) {
            closeFilterModal(false);
        }
    });

    document.getElementById('pendingOrdersBody').addEventListener('click', handleOrderActions);
    updateClearFiltersButtonVisibility();

    setInterval(syncWithFirebase, 5 * 60 * 1000);
    syncWithFirebase();
    setupRealtimeListener();
    
    initializeModal();
    
    // Initial load of orders
    loadPendingOrders();
   
    document.getElementById('pendingOrdersBody').addEventListener('click', (e) => {
        if (e.target.classList.contains('done-order')) {
            openStockRemovalDetailedModal(e.target.dataset.orderId);
        }
    });
}

let currentFilters = [];



// Modify the loadPendingOrders function
function loadPendingOrders() {
    const pendingOrdersBody = document.getElementById('pendingOrdersBody');
    const detailedHeader = document.getElementById('pendingOrdersHeadDetailed');
    const summarizedHeader = document.getElementById('pendingOrdersHeadSummarized');
    const isDetailed = document.getElementById('viewToggle').checked;
    
    console.log('View mode:', isDetailed ? 'Detailed' : 'Summarized');
    console.log('Current filters:', currentFilters);

    pendingOrdersBody.innerHTML = '<tr><td colspan="5">Loading orders...</td></tr>';
    detailedHeader.style.display = isDetailed ? '' : 'none';
    summarizedHeader.style.display = isDetailed ? 'none' : '';

    syncWithFirebase()
        .then(() => getOrdersFromIndexedDB())
        .then(orders => {
            // Filter orders based on quantity and current filters
            // Remove the status filter as we're not distinguishing between pending and archived
            orders = orders.filter(order => 
                calculateTotalQuantityForOrder(order) > 0 &&
                (currentFilters.length === 0 || currentFilters.includes(order.partyName))
            );

            if (!orders || orders.length === 0) {
                pendingOrdersBody.innerHTML = '<tr><td colspan="5">No orders found</td></tr>';
                return;
            }

            if (isDetailed) {
                displayDetailedOrders(orders, pendingOrdersBody);
            } else {
                displaySummarizedOrders(orders, pendingOrdersBody);
            }
            loadDeletedOrders();
  
        })
        .catch(error => {
            console.error("Error loading orders: ", error);
            pendingOrdersBody.innerHTML = '<tr><td colspan="5">Error loading orders. Please try again.</td></tr>';
        });
}
function displayOrders(orders, isDetailed) {
    console.log('Total orders:', orders.length);
    
    // Apply filters
    orders = orders.filter(order => 
        currentFilters.length === 0 || currentFilters.includes(order.partyName)
    );
    console.log('Orders after filtering:', orders.length);

    const pendingOrdersBody = document.getElementById('pendingOrdersBody');
    
    if (orders.length > 0) {
        if (isDetailed) {
            displayDetailedOrders(orders, pendingOrdersBody);
        } else {
            displaySummarizedOrders(orders, pendingOrdersBody);
        }
    } else {
        pendingOrdersBody.innerHTML = `<tr><td colspan="${isDetailed ? 5 : 3}">No pending orders found</td></tr>`;
    }
}



function fetchOrdersFromFirebase() {
    return firebase.database().ref('orders').orderByChild('status').equalTo('Pending').once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                let orders = [];
                snapshot.forEach(childSnapshot => {
                    const order = childSnapshot.val();
                    order.id = childSnapshot.key;
                    // Process items to flatten the structure
                    if (order.items && Array.isArray(order.items)) {
                        order.items = order.items.flatMap(item => {
                            if (item.colors) {
                                return Object.entries(item.colors).map(([color, sizes]) => ({
                                    name: item.name,
                                    color: color,
                                    quantities: sizes
                                }));
                            } else {
                                return [{
                                    name: item.name,
                                    color: 'N/A',
                                    quantities: {}
                                }];
                            }
                        });
                    } else {
                        order.items = [];
                    }
                    orders.push(order);
                });
                console.log('Fetched and processed orders from Firebase:', orders);
                return orders;
            } else {
                console.log('No pending orders found in Firebase');
                return [];
            }
        })
        .catch(error => {
            console.error('Error fetching orders from Firebase:', error);
            throw error;
        });
}


function displayDetailedOrders(orders, container) {
    console.log('Displaying detailed orders. Total orders:', orders.length);
    container.innerHTML = '';
  
    // Add CSS styles for stock availability and status icon
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .stock-full {
            background-color: #FFFACD !important;
        }
        .stock-partial {
            background-color: #E3F2FD !important;
        }
        .status-icon {
            cursor: pointer;
            margin-left: 8px;
            font-size: 1em;
            display: inline-block;
            vertical-align: middle;
        }
        .status-cross {
            color: #dc3545;
        }
        .status-tick {
            color: #28a745;
        }
        .order-number-line {
            display: flex;
            align-items: center;
            margin-bottom: 4px;
        }
        .order-details {
            margin-top: 4px;
        }
        .three-dot-menu {
            position: absolute;
            right: 15px;
            top: 10px;
        }
        .order-header {
            position: relative;
            padding-right: 40px;
        }
        
        /* Expiry Indicator Styles */
        .expiry-indicator {
            display: inline-flex;
            align-items: center;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            position: relative;
            overflow: hidden;
        }
        
        .expiry-indicator::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0.1;
            background: currentColor;
        }
        
        .expiry-indicator .icon {
            margin-right: 4px;
            font-size: 14px;
        }
        
        .expiry-normal {
            background-color: #e8f5e9;
            color: #2e7d32;
            border-left: 3px solid #2e7d32;
        }
        
        .expiry-warning {
            background-color: #fff8e1;
            color: #ff8f00;
            border-left: 3px solid #ff8f00;
        }
        
        .expiry-critical {
            background-color: #ffebee;
            color: #c62828;
            border-left: 3px solid #c62828;
            animation: pulse 2s infinite;
        }
        
        .expiry-expired {
            background-color: #f5f5f5;
            color: #616161;
            border-left: 3px solid #616161;
        }
        
        .expiry-progress {
            width: 100%;
            height: 6px;
            border-radius: 3px;
            overflow: hidden;
            background: #f5f5f5;
            margin-top: 4px;
        }
        
        .expiry-progress-bar {
            height: 100%;
            transition: width 0.3s ease;
        }
        
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
    `;
    document.head.appendChild(styleElement);
  
    // Get stock data from IndexedDB
    getStockData().then(stockData => {
        // Get export status data from Firebase
        getExportStatusFromFirebase((exportStatus) => {
            // Sort orders by expiry status (critical first)
            orders.sort((a, b) => {
                const statusA = a.expiryDate ? getExpiryStatus(a.expiryDate).status : 'normal';
                const statusB = b.expiryDate ? getExpiryStatus(b.expiryDate).status : 'normal';
                
                const priority = { 'expired': 0, 'critical': 1, 'warning': 2, 'normal': 3 };
                return priority[statusA] - priority[statusB];
            });

            orders.forEach(order => {
                const orderDate = new Date(order.dateTime).toLocaleDateString();
                const orderDiv = document.createElement('div');
                orderDiv.className = 'order-container mb-4';
                orderDiv.dataset.orderId = order.id;
                
                const isExported = exportStatus[order.id] || false;
                const statusIcon = isExported ? '✓' : '✕';
                const statusClass = isExported ? 'status-tick' : 'status-cross';
                
                // Calculate expiry status
                const expiryStatus = order.expiryDate ? getExpiryStatus(order.expiryDate) : null;
  
                orderDiv.innerHTML = `
                    <div class="order-header mb-2">
                        <div class="order-number-line">
                            <strong>Order No. ${order.orderNumber || 'N/A'}</strong>
                            <span class="status-icon ${statusClass}" id="status-${order.id}">${statusIcon}</span>
                            ${expiryStatus ? `
                            <span class="expiry-indicator ${expiryStatus.class}" 
                                  data-bs-toggle="tooltip" 
                                  title="Expiry: ${new Date(order.expiryDate).toLocaleDateString()} (${expiryStatus.days} days remaining)">
                                <span class="icon">${expiryStatus.icon}</span>
                                ${expiryStatus.label}
                            </span>
                            ` : ''}
                        </div>
                        ${expiryStatus ? `
                        <div class="order-expiry-header">
                            <div class="expiry-progress">
                                <div class="expiry-progress-bar ${expiryStatus.class}" 
                                     style="width: ${expiryStatus.percentage}%"></div>
                            </div>
                        </div>
                        ` : ''}
                        <div class="order-details">
                            Party Name: ${order.partyName || 'N/A'}<br>
                            Date: ${orderDate}
                        </div>
                        <div class="three-dot-menu">
                            <button class="btn btn-sm btn-link dropdown-toggle" type="button" id="dropdownMenuButton-${order.id}">
                                &#8942;
                            </button>
                            <div class="dropdown-menu" id="dropdown-${order.id}">
                                <a class="dropdown-item delete-order" href="#" data-order-id="${order.id}">Delete</a>
                                <a class="dropdown-item export-order" href="#" data-order-id="${order.id}">Export</a>
                            </div>
                        </div>
                    </div>
                    <table class="table table-sm table-bordered">
                        <thead>
                            <tr>
                                <th>Item Name</th>
                                <th>Order</th>
                                <th>SRQ</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${generateOrderItemRowsWithStock(order.items, order.id, stockData)}
                        </tbody>
                    </table>
                    <div class="order-actions mt-2 text-right">
                        <button class="btn btn-sm btn-primary done-order" data-order-id="${order.id}" style="display: none;">Done</button>
                    </div>
                    <hr>
                `;
  
                container.appendChild(orderDiv);
  
                // Add existing event listeners
                const dropdownToggle = orderDiv.querySelector(`#dropdownMenuButton-${order.id}`);
                const dropdownMenu = orderDiv.querySelector(`#dropdown-${order.id}`);
  
                dropdownToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
                });
  
                const deleteButton = orderDiv.querySelector('.delete-order');
                deleteButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Delete button clicked for order:', order.id);
                    openDeleteModal1(order.id);
                    dropdownMenu.style.display = 'none';
                });
  
                const exportButton = orderDiv.querySelector('.export-order');
                exportButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Export button clicked for order:', order.id);
                    exportOrderToExcel(order);
                    updateExportStatus(order.id, true);
                    const statusIcon = orderDiv.querySelector(`#status-${order.id}`);
                    statusIcon.textContent = '✓';
                    statusIcon.classList.remove('status-cross');
                    statusIcon.classList.add('status-tick');
                    dropdownMenu.style.display = 'none';
                });
  
                document.addEventListener('click', () => {
                    dropdownMenu.style.display = 'none';
                });
  
                if (currentOrders[order.id]) {
                    updateDetailedView(order.id);
                }
            });
  
            // Initialize SRQ inputs after adding content to the DOM
            initializeSRQInputs(container);
            
            // Initialize tooltips
            $('[data-bs-toggle="tooltip"]').tooltip({
                boundary: 'window',
                trigger: 'hover focus'
            });
        });
    });
}

  
  function getExportStatusFromFirebase(callback) {
    try {
        firebase.database().ref('orderExportStatus').once('value', (snapshot) => {
            callback(snapshot.exists() ? snapshot.val() : {});
        }).catch((error) => {
            console.error('Error getting export status:', error);
            callback({});
        });
    } catch (error) {
        console.error('Error getting export status:', error);
        callback({});
    }
  }
  
  function updateExportStatus(orderId, isExported) {
    try {
        firebase.database().ref(`orderExportStatus/${orderId}`).set(isExported).then(() => {
            console.log('Export status updated successfully');
        }).catch((error) => {
            console.error('Error updating export status:', error);
        });
    } catch (error) {
      console.error('Error updating export status:', error);
    }
  }
// Function to get stock data from IndexedDB
function getStockData() {
    return new Promise((resolve, reject) => {
        const transaction = stockIndexedDB.transaction([STOCK_STORE_NAME], "readonly");
        const objectStore = transaction.objectStore(STOCK_STORE_NAME);
        const request = objectStore.getAll();

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            console.error("Error fetching stock data:", event.target.error);
            resolve([]); // Return empty array in case of error
        };
    });
}

function generateOrderItemRowsWithStock(items, orderId, stockData) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return '<tr><td colspan="3">No items found for this order</td></tr>';
    }

    return items.flatMap(item => {
        if (!item || !item.quantities || typeof item.quantities !== 'object') {
            console.warn(`Invalid item structure for order ${orderId}:`, item);
            return '';
        }

        return Object.entries(item.quantities).map(([size, quantity]) => {
            const srqValue = item.srq && item.srq[size] ? item.srq[size] : 0;
            
            // Check stock availability
            const stockItem = stockData.find(stock => 
                stock['item name'] === item.name && 
                stock.color === item.color && 
                stock.size === size
            );
            
            const stockQuantity = stockItem ? parseFloat(stockItem.quantity) : 0;
            let stockClass = '';
            
            // Determine row color based on stock availability
            if (stockQuantity >= quantity) {
                stockClass = 'stock-full';
            } else if (stockQuantity > 0) {
                stockClass = 'stock-partial';
            }

            return `
                <tr class="${stockClass}">
                    <td>${item.name || 'Unknown'}(${item.color || 'N/A'})</td>
                    <td>${size}/${quantity}</td>
                    <td>
                        <div class="srq-input-group" data-max="${quantity}" data-item="${item.name || 'Unknown'}" data-color="${item.color || 'N/A'}" data-size="${size}">
                            <button class="btn btn-sm btn-outline-secondary srq-decrease">-</button>
                            <input type="number" class="form-control srq-input" value="${srqValue}" min="0" max="${quantity}">
                            <button class="btn btn-sm btn-outline-secondary srq-increase">+</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    }).join('');
}
function exportOrderToExcel(order) {
    console.log('Exporting order:', order);
    const exportData = [];

    order.items.forEach((item) => {
        if (item.quantities && typeof item.quantities === 'object') {
            Object.entries(item.quantities).forEach(([size, qty]) => {
                if (qty > 0) {
                    exportData.push({
                        'Item Name': item.name,
                        'Color': item.color,
                        'Size': size,
                        'Quantity': qty
                    });
                }
            });
        } else {
            console.warn(`No quantities found for item: ${item.name}, color: ${item.color}`);
        }
    });

    if (exportData.length === 0) {
        console.error('No data to export');
        alert('No data to export. Please check the order details.');
        return;
    }

    // Create and download Excel file
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Set column widths
    const colWidths = [
        { wch: 30 }, // Item Name
        { wch: 15 }, // Color
        { wch: 10 }, // Size
        { wch: 10 }  // Quantity
    ];
    ws['!cols'] = colWidths;

    // Calculate the last row of data
    const lastRow = exportData.length + 1; // +1 for header row

    // Add empty row for spacing
    XLSX.utils.sheet_add_json(ws, [{}], { origin: lastRow + 1 });

    // Add instructions
    const instructions = [
        ["COPY THE ABOVE DATA (DONT COPY HEADER) AND PASTE IT IN THE MAIN ORDER FORMAT OF COMPANY FROM A5838"],
        ["THEN PRESS (Alt + F11) AND CREATE NEW MODULE AND PASTE THE BELOW CODE THERE AND RUN IT"],
        ["CODE:"],
        [`Sub UpdateQuantities()
    Dim lastRow As Long
    Dim formLastRow As Long
    Dim inputRow As Long
    Dim formRow As Long
    Dim ws As Worksheet
    Dim found As Boolean
    Dim unmatchedCount As Long
    
    Set ws = ActiveSheet
    
    ' Form data starts at row 3, header is on row 2, ends at row 4351
    formLastRow = 4351
    
    ' Find last row of input data
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    
    ' Debug message to confirm data range
    MsgBox "Starting process. Input data from row 4352 to " & lastRow, vbInformation
    
    ' Clear any previous highlighting in the input area
    ws.Range("A4352:D" & lastRow).Interior.ColorIndex = xlNone
    
    unmatchedCount = 0
    
    ' Loop through each input row starting from 4352
    For inputRow = 4352 To lastRow
        found = False
        
        ' Get input values
        Dim inputStyle As String
        Dim inputColor As String
        Dim inputSize As String
        Dim inputQty As Variant
        
        inputStyle = ws.Cells(inputRow, 1).Value ' Column A
        inputColor = ws.Cells(inputRow, 2).Value ' Column B
        inputSize = ws.Cells(inputRow, 3).Value  ' Column C
        inputQty = ws.Cells(inputRow, 4).Value   ' Column D
        
        ' Skip empty rows
        If Trim(inputStyle) <> "" Then
            ' Loop through form rows to find matching entry
            For formRow = 3 To formLastRow  ' Start from row 3 (after header row 2)
                ' Get form values
                Dim formStyle As String
                Dim formColor As String
                Dim formSize As String
                
                formStyle = ws.Cells(formRow, "D").Value ' Style column D
                formColor = ws.Cells(formRow, "F").Value ' Color column F
                formSize = ws.Cells(formRow, "K").Value  ' Size column K
                
                ' Check if all criteria match
                If formStyle = inputStyle And _
                   formColor = inputColor And _
                   formSize = inputSize Then
                   
                    ' Update quantity in column O
                    ws.Cells(formRow, "O").Value = inputQty
                    found = True
                    Debug.Print "Match found for Style=" & inputStyle & _
                            ", Color=" & inputColor & _
                            ", Size=" & inputSize & _
                            " at row " & formRow
                    Exit For
                End If
            Next formRow
            
            ' Highlight unmatched entries in red
            If Not found Then
                ' Highlight entire row in light red
                With ws.Range("A" & inputRow & ":D" & inputRow).Interior
                    .Color = RGB(255, 200, 200) ' Light red color
                End With
                
                unmatchedCount = unmatchedCount + 1
                
                ' Log unmatched entry details
                Debug.Print "No match found for: Style=" & inputStyle & _
                            ", Color=" & inputColor & _
                            ", Size=" & inputSize
            End If
        End If
    Next inputRow
    
    ' Show completion message with count of unmatched entries
    If unmatchedCount > 0 Then
        MsgBox "Update complete!" & vbNewLine & _
               unmatchedCount & " unmatched entries were found and highlighted in red." & vbNewLine & _
               "(Check Immediate Window for details - Press Ctrl+G in VBA Editor)", _
               vbInformation
    Else
        MsgBox "Update complete! All entries were successfully matched." & vbNewLine & _
               "(Check Immediate Window for match details - Press Ctrl+G in VBA Editor)", _
               vbInformation
    End If
End Sub

`]
    ];

    // Add instructions to worksheet starting from the row after the data plus spacing
    instructions.forEach((row, index) => {
        XLSX.utils.sheet_add_json(ws, [{ 'Item Name': row[0] }], {
            origin: lastRow + 2 + index,
            skipHeader: true
        });
    });
    
    XLSX.utils.book_append_sheet(wb, ws, "Purchase Order");
    XLSX.writeFile(wb, `purchase_order_${order.orderNumber || 'export'}.xlsx`);

    // Email functionality remains the same
    setTimeout(() => {
        const to = 'vishalkulkarni@modenik.in';
        const cc = 'chandra.niwas@modenik.in,MANJUNATH.AVAROLKAR@modenik.in';
        const subject = 'ENAMOR ORDER - KAMBESHWAR AGENCIES';
        const body = `Dear Modenik Lifestyle Pvt Ltd (Enamor Division),

I hope this email finds you well. Please find the attached Enamor order to this email.

Thank you for your attention to this matter.

Best regards,
Kambeshwar Agencies`;

        const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&cc=${encodeURIComponent(cc)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        
        window.open(gmailComposeUrl, '_blank');
    }, 1000);
}

function addExportDataRow(exportData, itemName, color, size, qty) {
    console.log(`Attempting to match: Style=${itemName}, Color=${color}, Size=${size}`);
    const matchingEntry = purchaseOrderData.find(entry => 
        entry.style.trim().toLowerCase() === itemName.trim().toLowerCase() &&
        entry.color.trim().toLowerCase() === color.trim().toLowerCase() &&
        entry.size.trim().toLowerCase() === size.trim().toLowerCase()
    );

    if (matchingEntry) {
        console.log('Matching entry found:', matchingEntry);
        exportData.push({
            'Material Code': matchingEntry.materialCode,
            'Category': matchingEntry.category,
            'Style': matchingEntry.style,
            'Description': matchingEntry.description,
            'Color': matchingEntry.color,
            'Color Name': matchingEntry.colorName,
            'Style-Color': matchingEntry.stylecol,
            'Size': matchingEntry.size,
            'MRP': matchingEntry.mrp,
            'Pack Size': matchingEntry.packsize,
            'Quantity': qty
        });
    } else {
        console.log('No matching entry found. Adding new entry.');
        exportData.push({
            'Material Code': 'N/A',
            'Category': 'N/A',
            'Style': itemName,
            'Description': 'N/A',
            'Color': color,
            'Color Name': 'N/A',
            'Style-Color': 'N/A',
            'Size': size,
            'MRP': 'N/A',
            'Pack Size': 'N/A',
            'Quantity': qty
        });
    }
}
function generateOrderItemRows(items, orderId) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return '<tr><td colspan="3">No items found for this order</td></tr>';
    }
    
    return items.flatMap(item => {
        if (!item || !item.quantities || typeof item.quantities !== 'object') {
            console.warn(`Invalid item structure for order ${orderId}:`, item);
            return '';
        }

        return Object.entries(item.quantities).map(([size, quantity]) => {
            const srqValue = item.srq && item.srq[size] ? item.srq[size] : 0;
            return `
                <tr>
                    <td>${item.name || 'Unknown'}(${item.color || 'N/A'})</td>
                    <td>${size}/${quantity}</td>
                    <td>
                        <div class="srq-input-group" data-max="${quantity}" data-item="${item.name || 'Unknown'}" data-color="${item.color || 'N/A'}" data-size="${size}">
                            <button class="btn btn-sm btn-outline-secondary srq-decrease">-</button>
                            <input type="number" class="form-control srq-input" value="${srqValue}" min="0" max="${quantity}">
                            <button class="btn btn-sm btn-outline-secondary srq-increase">+</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    }).join('');
}
function generateOrderItemRows(items, orderId) {
    if (!items || !Array.isArray(items)) return '<tr><td colspan="3">No items</td></tr>';
    
    return items.flatMap(item => {
        return Object.entries(item.quantities || {}).map(([size, quantity]) => {
            const srqValue = item.srq && item.srq[size] ? item.srq[size] : 0;
            return `
                <tr>
                    <td>${item.name}(${item.color || 'N/A'})</td>
                    <td>${size}/${quantity}</td>
                    <td>
                        <div class="srq-input-group" data-max="${quantity}" data-item="${item.name}" data-color="${item.color}" data-size="${size}">
                            <button class="btn btn-sm btn-outline-secondary srq-decrease">-</button>
                            <input type="number" class="form-control srq-input" value="${srqValue}" min="0" max="${quantity}">
                            <button class="btn btn-sm btn-outline-secondary srq-increase">+</button>
                        </div>
                    </td>
                </tr>
            `;
        });
    }).join('');
}
function generateOrderItemRowsWithPending(items, orderId) {
    return items.flatMap(item => {
        return Object.entries(item.quantities || {}).map(([size, quantity]) => {
            const srqValue = item.srq && item.srq[size] ? item.srq[size] : 0;
            const pendingValue = quantity - srqValue;
            return `
                <tr>
                    <td>${item.name} (${item.color || 'N/A'})</td>
                    <td>${size}/${quantity}</td>
                    <td>
                        <div class="srq-input-group" data-max="${quantity}" data-item="${item.name}" data-color="${item.color}" data-size="${size}">
                            <button class="btn btn-sm btn-outline-secondary srq-decrease">-</button>
                            <input type="number" class="form-control srq-input" value="${srqValue}" min="0" max="${quantity}">
                            <button class="btn btn-sm btn-outline-secondary srq-increase">+</button>
                        </div>
                    </td>
                    <td class="pending-value">${pendingValue}</td>
                </tr>
            `;
        });
    }).join('');
}

function saveSRQValue(orderId, itemName, color, size, value) {
    // Update in IndexedDB
    getOrderById(orderId)
        .then(order => {
            const item = order.items.find(i => i.name === itemName && i.color === color);
            if (item) {
                if (!item.srq) item.srq = {};
                item.srq[size] = value;
                return saveOrdersToIndexedDB([order]);
            }
        })
        .then(() => {
            // Update in Firebase
            const orderRef = firebase.database().ref('orders').child(orderId);
            return orderRef.once('value')
                .then(snapshot => {
                    const firebaseOrder = snapshot.val();
                    const item = firebaseOrder.items.find(i => i.name === itemName && i.color === color);
                    if (item) {
                        if (!item.srq) item.srq = {};
                        item.srq[size] = value;
                        return orderRef.update({ items: firebaseOrder.items });
                    }
                });
        })
        .catch(error => console.error("Error saving SRQ value:", error));
}
function initializeSRQInputs(modal) {
    modal.querySelectorAll('.srq-input-group').forEach(group => {
        const input = group.querySelector('.srq-input');
        const decreaseBtn = group.querySelector('.srq-decrease');
        const increaseBtn = group.querySelector('.srq-increase');
        const max = parseInt(group.dataset.max);

        function updateSRQValue() {
            const value = parseInt(input.value);
            const orderId = modal.dataset.orderId;
            const itemName = group.dataset.item;
            const color = group.dataset.color;
            const size = group.dataset.size;
            updateOrderState(orderId, itemName, color, size, value);
            updateTotals(modal);
        }

        decreaseBtn.addEventListener('click', () => {
            if (parseInt(input.value) > 0) {
                input.value = parseInt(input.value) - 1;
                updateSRQValue();
            }
        });

        increaseBtn.addEventListener('click', () => {
            if (parseInt(input.value) < max) {
                input.value = parseInt(input.value) + 1;
                updateSRQValue();
            }
        });

        input.addEventListener('input', () => {
            let value = parseInt(input.value);
            if (isNaN(value)) value = 0;
            if (value < 0) value = 0;
            if (value > max) value = max;
            input.value = value;
            updateSRQValue();
        });
    });
}
// Modified initializeSRQInputs function
function initializeSRQInputs(container = document) {
    container.querySelectorAll('.srq-input-group').forEach(group => {
        const input = group.querySelector('.srq-input');
        const decreaseBtn = group.querySelector('.srq-decrease');
        const increaseBtn = group.querySelector('.srq-increase');
        const max = parseInt(group.dataset.max);
        const itemName = group.dataset.item;
        const color = group.dataset.color;
        const size = group.dataset.size;
        const orderId = group.closest('[data-order-id]').dataset.orderId;

        function updateSRQValue() {
            const value = parseInt(input.value);
            updateOrderState(orderId, itemName, color, size, value);
            updateAllViews(orderId);
        }

        decreaseBtn.addEventListener('click', () => {
            if (parseInt(input.value) > 0) {
                input.value = parseInt(input.value) - 1;
                updateSRQValue();
            }
        });

        increaseBtn.addEventListener('click', () => {
            if (parseInt(input.value) < max) {
                input.value = parseInt(input.value) + 1;
                updateSRQValue();
            }
        });

        input.addEventListener('input', () => {
            let value = parseInt(input.value);
            if (isNaN(value)) value = 0;
            if (value < 0) value = 0;
            if (value > max) value = max;
            input.value = value;
            updateSRQValue();
        });
    });
}
// Function to update all views
function updateAllViews(orderId) {
    updateDetailedView(orderId);
    updateStockRemovalDetailedModal(orderId);
}

// Function to update the detailed view
function updateDetailedView(orderId) {
    console.log(`Updating detailed view for order: ${orderId}`);
    const orderContainer = document.querySelector(`.order-container[data-order-id="${orderId}"]`);
    if (orderContainer) {
        const srqInputs = orderContainer.querySelectorAll('.srq-input');
        srqInputs.forEach(input => {
            const group = input.closest('.srq-input-group');
            const itemName = group.dataset.item;
            const color = group.dataset.color;
            const size = group.dataset.size;
            
            console.log(`Updating SRQ for: Item=${itemName}, Color=${color}, Size=${size}`);
            
            if (!currentOrders[orderId]) {
                console.warn(`No data for orderId: ${orderId} in currentOrders`);
                return;
            }
            if (!currentOrders[orderId][itemName]) {
                console.warn(`No data for itemName: ${itemName} in order ${orderId}`);
                return;
            }
            if (!currentOrders[orderId][itemName][color]) {
                console.warn(`No data for color: ${color} in item ${itemName} of order ${orderId}`);
                return;
            }
            
            const value = currentOrders[orderId][itemName][color][size] || 0;
            console.log(`Setting SRQ value to: ${value}`);
            input.value = value;
        });
        updateDoneButtonVisibility(orderContainer);
    } else {
        console.warn(`Order container not found for orderId: ${orderId}`);
    }
}

// Function to update the stock removal detailed modal
function updateStockRemovalDetailedModal(orderId) {
    const modal = document.querySelector('.stock-removal-detailed-modal');
    if (modal && modal.dataset.orderId === orderId) {
        const srqInputs = modal.querySelectorAll('.srq-input');
        srqInputs.forEach(input => {
            const group = input.closest('.srq-input-group');
            const itemName = group.dataset.item;
            const color = group.dataset.color;
            const size = group.dataset.size;
            const value = currentOrders[orderId][itemName][color][size] || 0;
            input.value = value;
        });
        updateTotals(modal);
    }
}



function updateDoneButtonVisibility(orderContainer) {
    const doneButton = orderContainer.querySelector('.done-order');
    const srqInputs = orderContainer.querySelectorAll('.srq-input');
    const hasNonZeroInput = Array.from(srqInputs).some(input => parseInt(input.value) > 0);
    doneButton.style.display = hasNonZeroInput ? 'inline-block' : 'none';
}

function getOrderById(orderId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database not initialized"));
            return;
        }
        const transaction = db.transaction([STORE_NAME], "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);
        const request = objectStore.get(orderId);
        
        request.onsuccess = (event) => {
            const order = event.target.result;
            if (order) {
                resolve(order);
            } else {
                reject(new Error("Order not found"));
            }
        };
        request.onerror = (event) => reject(event.target.error);
    });
}
function openStockRemovalDetailedModal(orderId) {
    getOrderById(orderId)
        .then(order => {
            const modal = document.createElement('div');
            modal.className = 'stock-removal-detailed-modal';
            modal.dataset.orderId = orderId;
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 class="modal-title">${order.partyName}</h2>
                        <button type="button" class="close" data-dismiss="modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="table-container" style="max-height: 60vh; overflow-y: auto;">
                            <table class="table table-bordered">
                                <thead>
                                    <tr>
                                        <th>Item Name</th>
                                        <th>Sizes</th>
                                        <th>SRQ</th>
                                        <th>P</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${generateOrderItemRowsWithPending(order.items, orderId)}
                                </tbody>
                            </table>
                        </div>
                        <div class="total-section">
                            <div class="total-header">T O T A L</div>
                            <div class="total-row">
                                <div class="total-item">
                                    <span>Total Order</span>
                                    <span id="totalOrder">0pc</span>
                                </div>
                                <div class="total-item">
                                    <span>Total Removed</span>
                                    <span id="totalRemoved">0pc</span>
                                </div>
                                <div class="total-item">
                                    <span>Total Pending</span>
                                    <span id="totalPending">0pc</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary send-to-billing-btn">Send to Billing</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const closeBtn = modal.querySelector('.close');
            closeBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
            });

            modal.querySelector('.send-to-billing-btn').addEventListener('click', () => {
                sendToBilling(orderId);
                document.body.removeChild(modal);
            });

            // Close modal when clicking outside
            modal.addEventListener('click', (event) => {
                if (event.target === modal) {
                    document.body.removeChild(modal);
                }
            });

            // Calculate and update totals
            updateTotals(modal);

            // Initialize SRQ inputs
            initializeSRQInputs(modal);
        })
        .catch(error => {
            console.error("Error opening stock removal modal:", error);
            alert("Error opening stock removal modal. Please try again.");
        });
}


// Global variable to store the current state of orders
let currentOrders = {};

// Function to update the order state


function generateModalItemRows(items) {
    return items.flatMap(item => {
        return Object.entries(item.quantities || {}).map(([size, quantity]) => `
            <tr>
                <td>${item.name} (${item.color || 'N/A'})</td>
                <td>${size}/${quantity}</td>
                <td>
                    <div class="srq-input-group" data-max="${quantity}" data-item="${item.name}" data-color="${item.color}" data-size="${size}">
                        <button class="btn btn-sm btn-outline-secondary srq-decrease">-</button>
                        <input type="number" class="form-control srq-input" value="0" min="0" max="${quantity}">
                        <button class="btn btn-sm btn-outline-secondary srq-increase">+</button>
                    </div>
                </td>
            </tr>
        `);
    }).join('');
}

function enableSRQModification(modal) {
    const srqInputGroups = modal.querySelectorAll('.srq-input-group');
    srqInputGroups.forEach(group => {
        const input = group.querySelector('.srq-input');
        const decreaseBtn = group.querySelector('.srq-decrease');
        const increaseBtn = group.querySelector('.srq-increase');
        const max = parseInt(group.dataset.max);

        decreaseBtn.addEventListener('click', () => {
            if (input.value > 0) {
                input.value = parseInt(input.value) - 1;
                updateTotals(modal);
            }
        });

        increaseBtn.addEventListener('click', () => {
            if (parseInt(input.value) < max) {
                input.value = parseInt(input.value) + 1;
                updateTotals(modal);
            }
        });

        input.addEventListener('input', () => {
            let value = parseInt(input.value);
            if (isNaN(value)) value = 0;
            if (value < 0) value = 0;
            if (value > max) value = max;
            input.value = value;
            updateTotals(modal);
        });
    });
}

function updateTotals(modal) {
    let totalOrder = 0;
    let totalRemoved = 0;
    let totalPending = 0;

    modal.querySelectorAll('.srq-input').forEach(input => {
        const row = input.closest('tr');
        const [, quantity] = row.querySelector('td:nth-child(2)').textContent.split('/');
        const srqValue = parseInt(input.value) || 0;
        const pendingValue = parseInt(quantity) - srqValue;

        totalOrder += parseInt(quantity);
        totalRemoved += srqValue;
        totalPending += pendingValue;

        row.querySelector('.pending-value').textContent = pendingValue;
    });

    modal.querySelector('#totalOrder').textContent = `${totalOrder}pc`;
    modal.querySelector('#totalRemoved').textContent = `${totalRemoved}pc`;
    modal.querySelector('#totalPending').textContent = `${totalPending}pc`;
}

function displaySummarizedOrders(orders, container) {
    console.log('Displaying summarized orders. Total orders:', orders.length);
    container.innerHTML = '';
    
    // Create a premium table structure
    const table = document.createElement('table');
    table.className = 'luxury-order-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th class="luxury-header">PARTY NAME</th>
                <th class="luxury-header">ORDER DETAILS</th>
                <th class="luxury-header">TOTAL QTY</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    container.appendChild(table);
    const tbody = table.querySelector('tbody');

    // Add luxury styling
    const style = document.createElement('style');
    style.textContent = `
        .luxury-order-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.08);
            border-radius: 12px;
            overflow: hidden;
            background: white;
        }
        
        .luxury-header {
            background: linear-gradient(135deg, #3a4a6b 0%, #2c3e50 100%);
            color: white;
            padding: 18px 20px;
            text-align: left;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            font-size: 13px;
            border: none;
            position: sticky;
            top: 0;
        }
        
        .luxury-order-table td {
            padding: 20px;
            border-bottom: 1px solid rgba(0,0,0,0.05);
            vertical-align: middle;
            background: white;
            position: relative;
        }
        
        .luxury-order-table tbody tr {
            transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            cursor: pointer;
        }
        
        .luxury-order-table tbody tr:hover {
            background: linear-gradient(to right, rgba(250,250,252,1) 0%, rgba(255,255,255,1) 100%);
            transform: translateY(-1px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.03);
        }
        
        .luxury-order-table tbody tr:last-child td {
            border-bottom: none;
        }
        
        .luxury-order-table tbody tr:after {
            content: "";
            position: absolute;
            left: 0;
            bottom: 0;
            width: 100%;
            height: 1px;
            background: linear-gradient(to right, transparent 0%, rgba(0,0,0,0.03) 50%, transparent 100%);
        }
        
        .party-name {
            font-weight: 600;
            color: #2c3e50;
            font-size: 15px;
            letter-spacing: 0.3px;
            margin-bottom: 4px;
        }
        
        .order-details {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        .order-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
        }
        
        .order-label {
            font-size: 13px;
            color: #7f8c8d;
            font-weight: 500;
            text-align: right;
        }
        
        .order-colon {
            font-size: 13px;
            color: #7f8c8d;
            margin: 0 8px;
        }
        
        .order-number {
            font-size: 13px;
            color: #7f8c8d;
            font-weight: 500;
            text-align: left;
        }
        
        .order-date {
            font-size: 12px;
            color: #95a5a6;
            letter-spacing: 0.2px;
        }
        
        .item-names {
            display: block;
            line-height: 1.5;
            font-size: 13px;
            color: #34495e;
            font-weight: 400;
        }
        
        .item-list {
            margin: 0;
            padding: 0;
            list-style-type: none;
        }
        
        .item-list li {
            padding: 2px 0;
        }
        
        .total-quantity {
            font-weight: 700;
            color: #2c3e50;
            text-align: center;
            font-size: 15px;
            position: relative;
        }
        
        .total-quantity:after {
            content: "";
            position: absolute;
            right: -12px;
            top: 50%;
            transform: translateY(-50%);
            width: 8px;
            height: 8px;
            background: #3498db;
            border-radius: 50%;
            opacity: 0.3;
        }
        
        /* Sent to billing indicator */
        .sent-to-billing td:first-child {
            border-left: 4px solid #27ae60;
        }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
            .luxury-order-table {
                font-size: 13px;
            }
            
            .luxury-order-table td {
                padding: 15px 12px;
            }
            
            .luxury-header {
                padding: 15px 12px;
                font-size: 12px;
            }
        }
    `;
    document.head.appendChild(style);

    const groupedOrders = groupOrdersByParty(orders);
    
    for (const [partyName, group] of Object.entries(groupedOrders)) {
        // Sort group by date (newest first)
        group.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
        
        const newestOrder = group[0];
        const oldestOrder = group[group.length - 1];
        
        const nonZeroItems = group.flatMap(order => 
            (order.items || []).filter(item => {
                const totalQuantity = Object.values(item.quantities || {})
                    .reduce((sum, qty) => sum + parseInt(qty) || 0, 0);
                return totalQuantity > 0;
            })
        );
        
        const totalQty = nonZeroItems.reduce((sum, item) => {
            const itemTotal = Object.values(item.quantities || {})
                .reduce((itemSum, qty) => itemSum + parseInt(qty) || 0, 0);
            return sum + itemTotal;
        }, 0);

        // Get unique item codes without truncation
        const uniqueItemCodes = [...new Set(nonZeroItems.map(item => 
            item.name.split('(')[0].trim()
        ))];
        
        // Create HTML list for items
        const itemListHTML = `
            <ul class="item-list">
                ${uniqueItemCodes.map(code => `<li>${code}</li>`).join('')}
            </ul>
        `;

        const newestOrderDate = new Date(newestOrder.dateTime);
        const oldestOrderDate = new Date(oldestOrder.dateTime);
        
        const dateRange = newestOrderDate.toLocaleDateString() === oldestOrderDate.toLocaleDateString() ? 
            newestOrderDate.toLocaleDateString() : 
            `${oldestOrderDate.toLocaleDateString()} - ${newestOrderDate.toLocaleDateString()}`;

        const row = document.createElement('tr');
        row.classList.toggle('sent-to-billing', group.some(o => o.status === 'Sent to Billing'));
        
        row.innerHTML = `
            <td>
                <div class="party-name">${partyName}</div>
                <div class="order-date">${dateRange}</div>
            </td>
            <td>
                <div class="order-details">
                   
                    <div class="item-names">${itemListHTML}</div>
                </div>
            </td>
            <td class="total-quantity">${totalQty}</td>
        `;
        
        // Add subtle animation on hover
        row.style.transition = 'all 0.3s ease';
        
        // Add click handler for the entire row
        row.addEventListener('click', () => {
            row.style.transform = 'scale(0.99)';
            setTimeout(() => {
                row.style.transform = '';
                openPremiumStockRemovalModal(partyName, group);
            }, 150);
        });
        
        tbody.appendChild(row);
    }
}
function openPremiumStockRemovalModal(partyName, orders) {
    console.log('Opening premium modal for party:', partyName);
    
    // Create modal container with glass morphism effect
    const modal = document.createElement('div');
    modal.className = 'premium-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'premium-modal-content';
    modalContent.style.cssText = `
        background: rgba(255,255,255,0.9);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 24px;
        width: 90%;
        max-width: 1200px;
        max-height: 90vh;
        overflow: hidden;
        box-shadow: 0 25px 50px rgba(0,0,0,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        transform: translateY(20px);
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;
    
    // Add header with party name as main heading
    const modalHeader = document.createElement('div');
    modalHeader.className = 'premium-modal-header';
    modalHeader.style.cssText = `
        padding: 20px 30px;
        background: linear-gradient(135deg, rgba(58, 74, 107, 0.9) 0%, rgba(44, 62, 80, 0.95) 100%);
        color: white;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    
    const modalTitle = document.createElement('h2');
    modalTitle.textContent = partyName;
    modalTitle.style.cssText = `
        margin: 0;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: 0.5px;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
        background: none;
        border: none;
        color: white;
        font-size: 28px;
        cursor: pointer;
        transition: transform 0.2s ease;
    `;
    closeBtn.addEventListener('mouseover', () => {
        closeBtn.style.transform = 'rotate(90deg)';
    });
    closeBtn.addEventListener('mouseout', () => {
        closeBtn.style.transform = 'rotate(0)';
    });
    closeBtn.addEventListener('click', () => {
        modal.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(modal);
        }, 300);
    });
    
    modalHeader.appendChild(modalTitle);
    modalHeader.appendChild(closeBtn);
    
    // Create modal body with tabs for each order
    const modalBody = document.createElement('div');
    modalBody.className = 'premium-modal-body';
    modalBody.style.cssText = `
        padding: 0;
        overflow-y: auto;
        max-height: calc(90vh - 70px);
    `;
    
    // Create tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.style.cssText = `
        display: flex;
        background: rgba(240,240,240,0.7);
        border-bottom: 1px solid rgba(0,0,0,0.05);
        padding: 0 20px;
    `;
    
    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.style.cssText = `
        padding: 20px 30px;
    `;
    
    // Sort orders by date (newest first)
    orders.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    
    // Create tabs and content for each order
    orders.forEach((order, index) => {
        const orderDate = new Date(order.dateTime);
        const today = new Date();
        const daysSinceOrder = Math.ceil((today - orderDate) / (1000 * 60 * 60 * 24));
        
        // Calculate expiry status
        const expiryStatus = order.expiryDate ? getExpiryStatus(order.expiryDate) : null;
        
        // Create tab
        const tab = document.createElement('button');
        tab.className = 'premium-modal-tab';
        tab.textContent = `Order #${order.orderNumber || 'N/A'}`;
        tab.style.cssText = `
            padding: 12px 20px;
            background: none;
            border: none;
            border-bottom: 3px solid transparent;
            font-weight: 500;
            color: #7f8c8d;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
        `;
        
        if (index === 0) {
            tab.style.borderBottomColor = '#3498db';
            tab.style.color = '#2c3e50';
            tab.style.fontWeight = '600';
        }
        
        tab.addEventListener('click', () => {
            // Update active tab
            document.querySelectorAll('.premium-modal-tab').forEach(t => {
                t.style.borderBottomColor = 'transparent';
                t.style.color = '#7f8c8d';
                t.style.fontWeight = '500';
            });
            tab.style.borderBottomColor = '#3498db';
            tab.style.color = '#2c3e50';
            tab.style.fontWeight = '600';
            
            // Show corresponding content
            document.querySelectorAll('.premium-order-content').forEach(c => {
                c.style.display = 'none';
            });
            document.getElementById(`order-content-${index}`).style.display = 'block';
        });
        
        tabsContainer.appendChild(tab);
        
        // Create content
        const orderContent = document.createElement('div');
        orderContent.className = 'premium-order-content';
        orderContent.id = `order-content-${index}`;
        orderContent.style.cssText = `
            display: ${index === 0 ? 'block' : 'none'};
        `;
        
        // Add order header
        const orderHeader = document.createElement('div');
        orderHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid rgba(0,0,0,0.05);
        `;
        
        const orderDateElement = document.createElement('div');
        orderDateElement.style.cssText = `
            font-size: 14px;
            color: #7f8c8d;
            display: flex;
            align-items: center;
        `;
        orderDateElement.innerHTML = `
            <span style="margin-right: 10px; font-size: 18px;">📅</span>
            ${orderDate.toLocaleDateString()} (${daysSinceOrder} days ago)
            ${expiryStatus ? `
            <span class="expiry-indicator ${expiryStatus.class}" 
                  style="margin-left: 15px; padding: 4px 10px; font-size: 12px;">
                <span class="icon">${expiryStatus.icon}</span>
                ${expiryStatus.label} - Expires: ${new Date(order.expiryDate).toLocaleDateString()}
            </span>
            ` : ''}
        `;
        
        const orderActions = document.createElement('div');
        orderActions.style.cssText = `
            display: flex;
            gap: 10px;
        `;
        
        const downloadImgBtn = document.createElement('button');
        downloadImgBtn.textContent = 'Download IMG';
        downloadImgBtn.style.cssText = `
            padding: 8px 15px;
            background: linear-gradient(135deg, #3498db 0%, #2c3e50 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 4px 10px rgba(52, 152, 219, 0.3);
        `;
        downloadImgBtn.addEventListener('mouseover', () => {
            downloadImgBtn.style.transform = 'translateY(-2px)';
            downloadImgBtn.style.boxShadow = '0 6px 15px rgba(52, 152, 219, 0.4)';
        });
        downloadImgBtn.addEventListener('mouseout', () => {
            downloadImgBtn.style.transform = 'translateY(0)';
            downloadImgBtn.style.boxShadow = '0 4px 10px rgba(52, 152, 219, 0.3)';
        });
        downloadImgBtn.addEventListener('click', () => {
            pendingOrderImg(order.orderNumber, index);
        });
        
        const downloadPdfBtn = document.createElement('button');
        downloadPdfBtn.textContent = 'Download PDF';
        downloadPdfBtn.style.cssText = `
            padding: 8px 15px;
            background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 4px 10px rgba(231, 76, 60, 0.3);
        `;
        downloadPdfBtn.addEventListener('mouseover', () => {
            downloadPdfBtn.style.transform = 'translateY(-2px)';
            downloadPdfBtn.style.boxShadow = '0 6px 15px rgba(231, 76, 60, 0.4)';
        });
        downloadPdfBtn.addEventListener('mouseout', () => {
            downloadPdfBtn.style.transform = 'translateY(0)';
            downloadPdfBtn.style.boxShadow = '0 4px 10px rgba(231, 76, 60, 0.3)';
        });
        downloadPdfBtn.addEventListener('click', () => {
            pendingOrderPdf(order.orderNumber, index);
        });
        
        orderActions.appendChild(downloadImgBtn);
        orderActions.appendChild(downloadPdfBtn);
        orderHeader.appendChild(orderDateElement);
        orderHeader.appendChild(orderActions);
        orderContent.appendChild(orderHeader);
        
        // Add items table
        if (order.items && Array.isArray(order.items)) {
            const table = document.createElement('table');
            table.style.cssText = `
                width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                margin-bottom: 20px;
            `;
            
            const thead = document.createElement('thead');
            thead.style.cssText = `
                background: rgba(240,240,240,0.7);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                position: sticky;
                top: 0;
            `;
            
            thead.innerHTML = `
                <tr>
                    <th style="padding: 15px; text-align: left; border-bottom: 2px solid rgba(0,0,0,0.1);">Item Name & Color</th>
                    <th style="padding: 15px; text-align: left; border-bottom: 2px solid rgba(0,0,0,0.1);">Sizes</th>
                    <th style="padding: 15px; text-align: right; border-bottom: 2px solid rgba(0,0,0,0.1);">Quantity</th>
                </tr>
            `;
            
            const tbody = document.createElement('tbody');
            
            order.items.forEach(item => {
                const sizesWithQuantities = Object.entries(item.quantities || {})
                    .map(([size, quantity]) => `${size}/${quantity}`)
                    .join(', ');
                const itemQty = Object.values(item.quantities || {}).reduce((sum, qty) => sum + parseInt(qty) || 0, 0);
                
                const row = document.createElement('tr');
                row.style.cssText = `
                    transition: background-color 0.3s ease;
                `;
                row.addEventListener('mouseover', () => {
                    row.style.backgroundColor = 'rgba(52, 152, 219, 0.05)';
                });
                row.addEventListener('mouseout', () => {
                    row.style.backgroundColor = '';
                });
                
                row.innerHTML = `
                    <td style="padding: 15px; border-bottom: 1px solid rgba(0,0,0,0.05);">
                        <div style="font-weight: 500;">${item.name}</div>
                        <div style="font-size: 13px; color: #7f8c8d; margin-top: 5px;">
                            Color: ${item.color || 'N/A'}
                        </div>
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid rgba(0,0,0,0.05);">
                        ${sizesWithQuantities}
                    </td>
                    <td style="padding: 15px; border-bottom: 1px solid rgba(0,0,0,0.05); text-align: right; font-weight: 500;">
                        ${itemQty}
                    </td>
                `;
                
                tbody.appendChild(row);
            });
            
            table.appendChild(thead);
            table.appendChild(tbody);
            orderContent.appendChild(table);
        } else {
            orderContent.innerHTML += '<p>No items found or error in data structure</p>';
        }
        
        contentContainer.appendChild(orderContent);
    });
    
    modalBody.appendChild(tabsContainer);
    modalBody.appendChild(contentContainer);
    
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Animate modal in
    setTimeout(() => {
        modal.style.opacity = '1';
        modalContent.style.transform = 'translateY(0)';
    }, 10);
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(modal);
            }, 300);
        }
    });
    
    // Store orders data in a global variable for access by download functions
    window.currentModalOrders = orders;
}

// Helper function to determine expiry status (should be defined elsewhere in your code)
function getExpiryStatus(expiryDate) {
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    
    if (daysRemaining <= 0) {
        return {
            status: 'expired',
            class: 'expiry-expired',
            label: 'Expired',
            icon: '⏱️',
            days: 0,
            percentage: 0
        };
    } else if (daysRemaining <= 5) {
        return {
            status: 'critical',
            class: 'expiry-critical',
            label: `Critical (${daysRemaining}d)`,
            icon: '⚠️',
            days: daysRemaining,
            percentage: Math.min(100, Math.max(0, (daysRemaining / 5) * 100))
        };
    } else if (daysRemaining <= 10) {
        return {
            status: 'warning',
            class: 'expiry-warning',
            label: `Warning (${daysRemaining}d)`,
            icon: '🔔',
            days: daysRemaining,
            percentage: Math.min(100, Math.max(0, (daysRemaining / 10) * 100))
        };
    } else {
        return {
            status: 'normal',
            class: 'expiry-normal',
            label: `Normal (${daysRemaining}d)`,
            icon: '✅',
            days: daysRemaining,
            percentage: Math.min(100, Math.max(0, (daysRemaining / 30) * 100))
        };
    }
}

function setupOrderNumberInteractions() {
    const orderNumbers = document.querySelectorAll('.order-number');
    let pressTimer;
    
    orderNumbers.forEach(orderNumber => {
        // Double click handler
        orderNumber.addEventListener('dblclick', function(e) {
            e.preventDefault();
            showDownloadButtons(this);
        });
        
        // Long press handler
        orderNumber.addEventListener('mousedown', function() {
            pressTimer = window.setTimeout(() => {
                showDownloadButtons(this);
            }, 3000); // 3 seconds long press
        });
        
        // Touch events for mobile
        orderNumber.addEventListener('touchstart', function(e) {
            pressTimer = window.setTimeout(() => {
                showDownloadButtons(this);
            }, 3000); // 3 seconds long press
        });
        
        orderNumber.addEventListener('touchend', function() {
            clearTimeout(pressTimer);
        });
        
        orderNumber.addEventListener('mouseup', function() {
            clearTimeout(pressTimer);
        });
        
        orderNumber.addEventListener('mouseleave', function() {
            clearTimeout(pressTimer);
        });
    });
}

function showDownloadButtons(orderNumberElement) {
    const downloadButtons = orderNumberElement.querySelector('.download-buttons');
    if (downloadButtons) {
        // Hide any other visible download buttons first
        document.querySelectorAll('.download-buttons').forEach(btn => {
            if (btn !== downloadButtons) {
                btn.style.display = 'none';
            }
        });
        
        downloadButtons.style.display = 'block';
        
        // Setup download button event handlers - we do this here to ensure we have the latest data
        const imgBtn = downloadButtons.querySelector('.download-img-btn');
        const pdfBtn = downloadButtons.querySelector('.download-pdf-btn');
        const orderIndex = orderNumberElement.getAttribute('data-order-index');
        const orderId = orderNumberElement.getAttribute('data-order-id');
        
        if (imgBtn) {
            // Remove any existing event listeners
            imgBtn.replaceWith(imgBtn.cloneNode(true));
            const newImgBtn = downloadButtons.querySelector('.download-img-btn');
            newImgBtn.addEventListener('click', function() {
                pendingOrderImg(orderId, parseInt(orderIndex));
            });
        }
        
        if (pdfBtn) {
            // Remove any existing event listeners
            pdfBtn.replaceWith(pdfBtn.cloneNode(true));
            const newPdfBtn = downloadButtons.querySelector('.download-pdf-btn');
            newPdfBtn.addEventListener('click', function() {
                pendingOrderPdf(orderId, parseInt(orderIndex));
            });
        }
        
        // Auto-hide after 4 seconds
        setTimeout(() => {
            downloadButtons.style.display = 'none';
        }, 4000);
    }
}
function pendingOrderImg(orderId, orderIndex) {
    console.log(`Generating image for order: ${orderId} at index ${orderIndex}`);
    
    if (!window.currentModalOrders || !window.currentModalOrders[orderIndex]) {
        console.error('Order data not found');
        return;
    }
    
    const order = window.currentModalOrders[orderIndex];
    const partyName = document.querySelector('#stockRemovalModal .modal-title').textContent;
    const orderDate = new Date(order.dateTime);
    
    // Create a temporary div for the order content
    const tempDiv = document.createElement('div');
    tempDiv.style.width = '375px'; // Mobile-friendly width
    tempDiv.style.padding = '15px';
    tempDiv.style.backgroundColor = 'white';
    tempDiv.style.fontFamily = 'Arial, sans-serif';
    
    // Create order header with party name as main heading
    tempDiv.innerHTML = `
        <div style="text-align: center; margin-bottom: 15px;">
            <h2 style="color: #333; margin-bottom: 5px; font-size: 18px;">${partyName}</h2>
            <p style="color: #666; margin: 5px 0; font-size: 14px;">Order #${order.orderNumber || 'N/A'}</p>
            <p style="color: #666; margin: 5px 0; font-size: 14px;">Date: ${orderDate.toLocaleDateString()}</p>
        </div>
    `;
    
    // Add table with proper styling
    tempDiv.innerHTML += `
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; table-layout: fixed;">
            <thead>
                <tr style="background-color: #f2f2f2;">
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left; width: 45%;">Item Name & Color</th>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: left; width: 40%;">Sizes</th>
                    <th style="border: 1px solid #ddd; padding: 8px; text-align: center; width: 15%;">Qty</th>
                </tr>
            </thead>
            <tbody id="order-items">
            </tbody>
        </table>
    `;
    
    // Append the temporary div to the body (hidden)
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    document.body.appendChild(tempDiv);
    
    // Get the tbody element to add rows
    const tbody = tempDiv.querySelector('#order-items');
    
    // Variables for totals
    let totalItems = 0;
    let totalQuantity = 0;
    
    // Add order items - process all at once without splitting
    if (order.items && Array.isArray(order.items)) {
        order.items.forEach((item) => {
            const sizesWithQuantities = Object.entries(item.quantities || {})
                .map(([size, quantity]) => `${size}/${quantity}`)
                .join(', ');
            const itemQty = Object.values(item.quantities || {}).reduce((sum, qty) => sum + parseInt(qty) || 0, 0);
            
            totalQuantity += itemQty;
            totalItems++;
            
            // Create row
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="border: 1px solid #ddd; padding: 8px; font-size: 12px; word-wrap: break-word;">${item.name} (${item.color || 'N/A'})</td>
                <td style="border: 1px solid #ddd; padding: 8px; font-size: 12px; word-wrap: break-word;">${sizesWithQuantities}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-size: 12px;">${itemQty}</td>
            `;
            tbody.appendChild(row);
        });
        
        // Add totals at the end - only once
        const totalsDiv = document.createElement('div');
        totalsDiv.style.textAlign = 'right';
        totalsDiv.style.marginTop = '15px';
        totalsDiv.innerHTML = `
            <p style="font-weight: bold; margin: 5px 0;">Total Items: ${totalItems}</p>
            <p style="font-weight: bold; margin: 5px 0;">Total Quantity: ${totalQuantity}</p>
        `;
        tempDiv.appendChild(totalsDiv);
        
        // Generate single image from the complete element
        generateImageFromElement(tempDiv).then(imgData => {
            // Download single image
            const link = document.createElement('a');
            link.href = imgData;
            link.download = `Order-${orderId}.png`;
            link.click();
            
            // Remove temporary element
            setTimeout(() => {
                document.body.removeChild(tempDiv);
            }, 1000);
        }).catch(error => {
            console.error('Error generating image:', error);
            document.body.removeChild(tempDiv);
        });
    } else {
        // No items, generate single image
        const noItemsRow = document.createElement('tr');
        noItemsRow.innerHTML = '<td colspan="3" style="border: 1px solid #ddd; padding: 8px; text-align: center;">No items found</td>';
        tbody.appendChild(noItemsRow);
        
        generateImageFromElement(tempDiv).then(imgData => {
            const link = document.createElement('a');
            link.href = imgData;
            link.download = `Order-${orderId}.png`;
            link.click();
            
            setTimeout(() => {
                document.body.removeChild(tempDiv);
            }, 1000);
        }).catch(error => {
            console.error('Error generating image:', error);
            document.body.removeChild(tempDiv);
        });
    }
}
function generateImageFromElement(element) {
    return new Promise((resolve, reject) => {
        html2canvas(element, {
            scale: 2, // For better quality
            backgroundColor: 'white',
            logging: false,
            width: element.offsetWidth,
            height: element.offsetHeight
        }).then(canvas => {
            resolve(canvas.toDataURL('image/png'));
        }).catch(error => {
            // Try alternate method if html2canvas fails
            if (typeof domtoimage !== 'undefined') {
                domtoimage.toPng(element)
                    .then(function (dataUrl) {
                        resolve(dataUrl);
                    })
                    .catch(function (error) {
                        reject(error);
                    });
            } else {
                reject(error);
            }
        });
    });
}

function pendingOrderPdf(orderId, orderIndex) {
    console.log(`Generating PDF for order: ${orderId} at index ${orderIndex}`);
    
    if (!window.currentModalOrders || !window.currentModalOrders[orderIndex]) {
        console.error('Order data not found');
        return;
    }
    
    const order = window.currentModalOrders[orderIndex];
    
    // Check if jsPDF is available
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        // Fallback: try to dynamically load jsPDF if not available
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = function() {
            generatePdf(order, orderId);
        };
        script.onerror = function() {
            alert('PDF generation requires jsPDF library. Please include it in your project.');
        };
        document.head.appendChild(script);
        return;
    }
    
    generatePdf(order, orderId);
}

function generatePdf(order, orderId) {
    // Initialize jsPDF
    const { jsPDF } = window.jspdf || window;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });
    
    // Set font sizes
    const titleSize = 16;
    const subtitleSize = 12;
    const normalSize = 10;
    const smallSize = 8;
    
    // Set page dimensions
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    
    // Get current date and time
    const orderDate = new Date(order.dateTime);
    const partyName = document.querySelector('#stockRemovalModal .modal-title').textContent;
    
    // Add header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(titleSize);
    doc.text(`Party: ${partyName}`, pageWidth / 2, margin, { align: 'center' });
   
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(subtitleSize);
    doc.text(`Date: ${orderDate.toLocaleDateString()}`, pageWidth / 2, margin + 7, { align: 'center' });
    doc.text(`Order #${order.orderNumber || 'N/A'}`, pageWidth / 2, margin + 12, { align: 'center' });
    
    // Table header position
    let yPos = margin + 20;
    
    // Draw table header
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(normalSize);
    doc.text('Item Name & Color', margin + 2, yPos + 5);
    doc.text('Sizes', margin + contentWidth * 0.5, yPos + 5);
    doc.text('Qty', margin + contentWidth - 10, yPos + 5, { align: 'right' });
    
    // Draw horizontal line
    yPos += 7;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, margin + contentWidth, yPos);
    
    // Add items
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(smallSize);
    
    if (order.items && Array.isArray(order.items)) {
        let totalQty = 0;
        
        order.items.forEach(item => {
            const sizesWithQuantities = Object.entries(item.quantities || {})
                .map(([size, quantity]) => `${size}/${quantity}`)
                .join(', ');
            const itemQty = Object.values(item.quantities || {}).reduce((sum, qty) => sum + parseInt(qty) || 0, 0);
            totalQty += itemQty;
            
            // Check if we need a new page
            if (yPos > doc.internal.pageSize.getHeight() - 20) {
                doc.addPage();
                yPos = margin;
            }
            
            // Draw item row
            yPos += 5;
            doc.text(`${item.name} (${item.color || 'N/A'})`, margin + 2, yPos);
            doc.text(sizesWithQuantities, margin + contentWidth * 0.5, yPos);
            doc.text(itemQty.toString(), margin + contentWidth - 10, yPos, { align: 'right' });
            yPos += 3;
            
            // Draw horizontal line
            doc.line(margin, yPos, margin + contentWidth, yPos);
            yPos += 2;
        });
        
        // Add footer with totals
        yPos += 5;
        doc.setFont('helvetica', 'bold');
        doc.text(`Total Items: ${order.items.length}`, margin + contentWidth - 40, yPos);
        yPos += 5;
        doc.text(`Total Quantity: ${totalQty}`, margin + contentWidth - 40, yPos);
    } else {
        yPos += 5;
        doc.text('No items found', margin + 2, yPos);
    }
    
    // Save the PDF
    doc.save(`Order-${orderId}.pdf`);
}

// Check if required libraries are available and load them if not
function checkAndLoadRequiredLibraries() {
    // Check for html2canvas
    if (typeof html2canvas === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        document.head.appendChild(script);
    }
    
    // Check for jsPDF
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        document.head.appendChild(script);
    }
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', checkAndLoadRequiredLibraries);


function initializeModal() {
    const modal = document.getElementById('stockRemovalModal');
    if (!modal) {
        console.error('Stock removal modal not found in the DOM');
        return;
    }

    const closeBtn = modal.querySelector('.close');
    if (!closeBtn) {
        console.error('Close button not found in the stock removal modal');
        return;
    }
    
    closeBtn.onclick = function() {
        modal.style.display = "none";
    }
    
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
}






function createOrderRow(order, orderId, isDetailed) {
    const row = document.createElement('tr');
    
    // Add a class if the order has been sent to billing
    if (order.status === 'Sent to Billing') {
        row.classList.add('sent-to-billing');
    }
    
    if (isDetailed) {
        row.innerHTML = `
            <td>${order.orderNumber || 'N/A'}</td>
            <td>${order.partyName || 'N/A'}</td>
            <td class="order-items">${getItemsSummary(order.items)}</td>
            <td>${order.status || 'N/A'}</td>
            <td>
                <button class="btn btn-sm btn-primary view-order" data-order-id="${orderId}">View</button>
                <button class="btn btn-sm btn-success complete-order" data-order-id="${orderId}">Mark for Billing</button>
            </td>
        `;
    } else {
        const orderDate = new Date(order.dateTime).toLocaleDateString();
        const totalQty = getTotalQuantity(order.items);
        
        row.innerHTML = `
            <td>${orderDate}</td>
            <td>${order.partyName || 'N/A'}</td>
            <td>${totalQty}</td>
        `;
    }
    
    return row;
}





function viewOrderDetails(orderId) {
    firebase.database().ref('orders').child(orderId).once('value')
        .then(snapshot => {
            const order = snapshot.val();
            console.log("Order details:", order);
            // Implement modal display logic here
        })
        .catch(error => {
            console.error("Error fetching order details: ", error);
        });
}





//___________BILLING OPERATION______________________
async function sendToBilling(orderId) {
    const modal = document.querySelector('.stock-removal-detailed-modal[data-order-id="' + orderId + '"]');
    const sendBtn = modal?.querySelector('.send-to-billing-btn');
    let originalBtnText = sendBtn?.innerHTML;

    try {
        // Show loading state
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
        }

        // Get order data
        const orderSnapshot = await firebase.database().ref('orders').child(orderId).once('value');
        const order = orderSnapshot.val();
        if (!order) throw new Error('Order not found');
        order.id = orderId; // Ensure ID exists

        // Get SRQ values from modal
        const srqValues = getCurrentSRQValuesFromModal(modal);

        // Prepare billing data
        const sobDate = new Date().toISOString();
        const sobDateOnly = sobDate.split('T')[0];

        // Check for existing billing orders to merge with
        const billingOrdersRef = firebase.database().ref('billingOrders');
        const billingSnapshot = await billingOrdersRef
            .orderByChild('orderNumber')
            .equalTo(order.orderNumber)
            .once('value');

        let billingOrderKey = null;
        let billingOrder = null;

        // Find order to merge with (same order number and same date)
        billingSnapshot.forEach(childSnapshot => {
            const existingOrder = childSnapshot.val();
            if (existingOrder.sobDate) {
                const existingSobDateOnly = existingOrder.sobDate.split('T')[0];
                if (existingSobDateOnly === sobDateOnly) {
                    billingOrder = existingOrder;
                    billingOrderKey = childSnapshot.key;
                }
            }
        });

        // Create or merge billing order
        if (billingOrder) {
            // MERGE LOGIC - This is the critical part for merging
            billingOrder = mergeBillingOrders(billingOrder, order, srqValues);
        } else {
            billingOrder = createBillingOrder(order, srqValues);
            billingOrder.sobDate = sobDate;
            billingOrderKey = billingOrdersRef.push().key;
        }

        // Update pending order
        const updatedPendingOrder = updatePendingOrder(order, srqValues);
        updatedPendingOrder.id = orderId;

        // Update both orders in Firebase
        const updates = {
            [`billingOrders/${billingOrderKey}`]: billingOrder,
            [`orders/${orderId}`]: updatedPendingOrder
        };
        await firebase.database().ref().update(updates);

        // Update in IndexedDB
        await saveOrdersToIndexedDB([updatedPendingOrder]);

        // Close modal and update UI
        if (modal) {
            modal.style.opacity = '0';
            setTimeout(() => modal.parentNode?.removeChild(modal), 300);
        }
        
        // Update both pending and billing sections
        updateUIAfterBilling(orderId, updatedPendingOrder);
        
        // NEW: Load billing orders to show the update in real-time
        loadBillingOrders();

    } catch (error) {
        console.error("Error sending order to billing:", error);
        showNotification('Error sending order to billing. Please try again.');
        if (sendBtn && originalBtnText) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalBtnText;
        }
    }
}
// Helper function to get SRQ values from modal
function getCurrentSRQValuesFromModal(modal) {
    const srqValues = {};
    modal?.querySelectorAll('.srq-input-group').forEach(group => {
        const input = group.querySelector('.srq-input');
        const itemName = group.dataset.item;
        const color = group.dataset.color;
        const size = group.dataset.size;
        
        if (!srqValues[itemName]) srqValues[itemName] = {};
        if (!srqValues[itemName][color]) srqValues[itemName][color] = {};
        
        srqValues[itemName][color][size] = parseInt(input.value) || 0;
    });
    return srqValues;
}

function updateUIAfterBilling(orderId, updatedOrder) {
    // 1. Update the order element in the pending orders list
    const orderElement = document.querySelector(`[data-order-id="${orderId}"]`);
    if (orderElement) {
        // Add visual indication
        orderElement.classList.add('sent-to-billing');
        
        // Hide the "Done" button if it exists
        const doneButton = orderElement.querySelector('.done-order');
        if (doneButton) {
            doneButton.style.display = 'none';
        }
        
        // Update the status icon
        const statusIcon = orderElement.querySelector('.status-icon');
        if (statusIcon) {
            statusIcon.textContent = '✓';
            statusIcon.classList.remove('status-cross');
            statusIcon.classList.add('status-tick');
        }
        
        // If in detailed view, update the quantities
        if (orderElement.querySelector('.srq-input')) {
            updateDetailedOrderQuantities(orderElement, updatedOrder);
        }
    }

    // 2. Show success notification
    showNotification('Order sent to billing successfully');
}

function updateDetailedOrderQuantities(orderElement, updatedOrder) {
    // Update the quantities to show what's remaining
    orderElement.querySelectorAll('.srq-input-group').forEach(group => {
        const input = group.querySelector('.srq-input');
        const itemName = group.dataset.item;
        const color = group.dataset.color;
        const size = group.dataset.size;
        
        // Find the remaining quantity in the updated order
        const item = updatedOrder.items.find(i => i.name === itemName);
        if (item && item.colors && item.colors[color] && item.colors[color][size]) {
            const remainingQty = item.colors[color][size];
            input.value = 0; // Reset SRQ input
            input.max = remainingQty; // Update max allowed value
            
            // Update the order quantity display
            const quantityCell = group.closest('tr').querySelector('td:nth-child(2)');
            if (quantityCell) {
                quantityCell.textContent = `${size}/${remainingQty}`;
            }
        } else {
            // If no quantity remaining, hide the row
            group.closest('tr').style.display = 'none';
        }
    });
    
    // Update totals display if exists
    const totalsSection = orderElement.querySelector('.total-section');
    if (totalsSection) {
        const totalOrder = calculateTotalQuantityForOrder(updatedOrder);
        const totalRemoved = calculateTotalQuantityForOrder(updatedOrder) - totalOrder;
        
        totalsSection.querySelector('#totalOrder').textContent = `${totalOrder}pc`;
        totalsSection.querySelector('#totalRemoved').textContent = `${totalRemoved}pc`;
        totalsSection.querySelector('#totalPending').textContent = `${totalOrder}pc`;
    }
}

// Add this CSS for visual feedback
const style = document.createElement('style');
style.textContent = `
    .sent-to-billing {
        background-color: rgba(40, 167, 69, 0.1) !important;
        border-left: 3px solid #28a745 !important;
        transition: all 0.3s ease;
    }
    
    .sent-to-billing .status-icon {
        color: #28a745 !important;
    }
    
    .spinner-border {
        display: inline-block;
        width: 1rem;
        height: 1rem;
        vertical-align: text-bottom;
        border: 0.2em solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: spinner-border 0.75s linear infinite;
    }
    
    @keyframes spinner-border {
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

function mergeBillingOrders(existingOrder, newOrder, srqValues) {
    // Create a fresh copy to avoid mutation issues
    const mergedOrder = {
        ...existingOrder,
        items: existingOrder.items.map(item => ({...item}))
    };

    // Initialize if needed
    mergedOrder.items = mergedOrder.items || [];
    mergedOrder.totalQuantity = mergedOrder.totalQuantity || 0;

    // Process each item from the new order
    newOrder.items.forEach(newItem => {
        const itemName = newItem.name;
        
        // Skip if no SRQ values for this item
        if (!srqValues[itemName]) {
            console.warn(`No SRQ values found for item: ${itemName}`);
            return;
        }

        // Find existing item in merged order
        let existingItem = mergedOrder.items.find(item => item.name === itemName);
        
        if (!existingItem) {
            // Create new item if it doesn't exist
            existingItem = {
                name: itemName,
                colors: {},
                totalQuantity: 0
            };
            mergedOrder.items.push(existingItem);
        }

        // Process each color/size from SRQ values
        Object.entries(srqValues[itemName]).forEach(([color, sizes]) => {
            existingItem.colors[color] = existingItem.colors[color] || {};
            
            Object.entries(sizes).forEach(([size, qty]) => {
                if (qty > 0) {
                    // Add SRQ quantities to existing quantities
                    // But only if they come from the new order (SRQ values)
                    const existingQty = existingItem.colors[color][size] || 0;
                    const newQty = qty; // Take SRQ value directly
                    
                    // Update quantity
                    existingItem.colors[color][size] = existingQty + newQty;
                    
                    // Update totals (only adding the new quantity)
                    existingItem.totalQuantity += newQty;
                    mergedOrder.totalQuantity += newQty;
                }
            });
        });
    });

    return mergedOrder;
}


// Add this function to your main JavaScript file or inline script
function checkAndShowPendingOrders() {
    if (localStorage.getItem('showPendingOrders') === 'true') {
        // Clear the flag
        localStorage.removeItem('showPendingOrders');

        // Show pending orders
        const pendingLink = document.querySelector('.nav-link[data-section="pending-orders"]');
        if (pendingLink) {
            pendingLink.click();
        } else if (typeof loadPendingOrders === 'function') {
            loadPendingOrders();
        }
    }
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', checkAndShowPendingOrders);
function showNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #4CAF50;
        color: white;
        padding: 15px;
        border-radius: 5px;
        z-index: 1000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 3000);
}



function createBillingOrder(order, srqValues) {
    const billingOrder = { 
        ...order,
        status: 'billing',
        totalQuantity: 0,
        sobDate: new Date().toISOString(),
        items: []
    };

    // Process each item only once
    order.items.forEach(item => {
        const billingItem = createBillingItem(item, srqValues[item.name] || {});
        if (billingItem.totalQuantity > 0) {
            billingOrder.items.push(billingItem);
            billingOrder.totalQuantity += billingItem.totalQuantity;
        }
    });

    return billingOrder;
}

function createBillingItem(item, srqValues) {
    const billingItem = {
        name: item.name,
        colors: {},
        totalQuantity: 0
    };

    // Only use SRQ values, don't merge with existing quantities
    Object.entries(srqValues).forEach(([color, sizes]) => {
        billingItem.colors[color] = {};
        
        Object.entries(sizes).forEach(([size, qty]) => {
            if (qty > 0) {
                billingItem.colors[color][size] = qty;
                billingItem.totalQuantity += qty;
            }
        });
    });

    return billingItem;
}
function updatePendingOrder(order, srqValues) {
    const updatedOrder = {...order};
    updatedOrder.totalQuantity = 0;

    updatedOrder.items = order.items.map(item => {
        const updatedItem = {...item};
        updatedItem.colors = {};

        if (item.colors) {
            // Merged order structure
            Object.keys(item.colors).forEach(color => {
                if (srqValues[item.name] && srqValues[item.name][color]) {
                    updatedItem.colors[color] = {};
                    Object.keys(item.colors[color]).forEach(size => {
                        const originalQty = item.colors[color][size];
                        const srqValue = srqValues[item.name][color][size] || 0;
                        const remainingQty = originalQty - srqValue;
                        if (remainingQty > 0) {
                            updatedItem.colors[color][size] = remainingQty;
                            updatedOrder.totalQuantity += remainingQty;
                        }
                    });
                }
            });
        } else if (item.quantities) {
            // Normal order structure
            const color = item.color || 'N/A';
            updatedItem.colors[color] = {};
            Object.keys(item.quantities).forEach(size => {
                const originalQty = item.quantities[size];
                const srqValue = srqValues[item.name] && srqValues[item.name][color] && srqValues[item.name][color][size] || 0;
                const remainingQty = originalQty - srqValue;
                if (remainingQty > 0) {
                    updatedItem.colors[color][size] = remainingQty;
                    updatedOrder.totalQuantity += remainingQty;
                }
            });
        }

        return updatedItem;
    }).filter(item => Object.keys(item.colors).length > 0);

    return updatedOrder;
}

function markForBilling(orderId) {
    firebase.database().ref('orders').child(orderId).update({ status: 'Waiting for Billing' })
        .then(() => {
            console.log("Order marked for billing successfully");
            loadPendingOrders();
        })
        .catch(error => {
            console.error("Error marking order for billing: ", error);
        });
}

function getCurrentSRQValues(orderId) {
    const srqValues = {};
    const srqInputs = document.querySelectorAll(`[data-order-id="${orderId}"] .srq-input`);
    
    srqInputs.forEach(input => {
        const group = input.closest('.srq-input-group');
        const itemName = group.dataset.item;
        const color = group.dataset.color;
        const size = group.dataset.size;
        
        if (!srqValues[itemName]) srqValues[itemName] = {};
        if (!srqValues[itemName][color]) srqValues[itemName][color] = {};
        
        // Ensure we only take the value once and parse it correctly
        const value = parseInt(input.value) || 0;
        srqValues[itemName][color][size] = value;
    });
    
    return srqValues;
}

//_____________Order Processing____________

function calculateTotalQuantityForOrder(order) {
    if (order.totalQuantity) return order.totalQuantity;
    
    return order.items ? order.items.reduce((total, item) => {
        return total + Object.values(item.quantities || {}).reduce((sum, qty) => sum + parseInt(qty) || 0, 0);
    }, 0) : 0;
}
function calculateTotalOrder(items) {
    return items.reduce((total, item) => total + Object.values(item.quantities || {}).reduce((sum, qty) => sum + parseInt(qty), 0), 0);
}

function calculateTotalRemoved(items) {
    return items.reduce((total, item) => total + (item.srq || 0), 0);
}

function calculateTotalPending(items) {
    return calculateTotalOrder(items) - calculateTotalRemoved(items);
}
function getUniqueItems(orders) {
    console.log('Orders received:', orders);
    const uniqueItems = new Map();
    orders.forEach(order => {
        console.log('Processing order:', order);
        if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
                console.log('Processing item:', item);
                const key = `${item.name}-${item.color || 'N/A'}`;
                if (!uniqueItems.has(key)) {
                    uniqueItems.set(key, {
                        name: item.name,
                        color: item.color || 'N/A',
                        sizes: new Set()
                    });
                }
                if (item.quantities) {
                    console.log('Item quantities:', item.quantities);
                    Object.keys(item.quantities).forEach(size => {
                        if (item.quantities[size] > 0) {
                            uniqueItems.get(key).sizes.add(size);
                        }
                    });
                } else {
                    console.warn('No quantities found for item:', item);
                }
            });
        } else {
            console.warn('No items array found in order:', order);
        }
    });
    const result = Array.from(uniqueItems.values()).map(item => ({
        ...item,
        sizes: Array.from(item.sizes).sort()
    }));
    console.log('Unique items result:', result);
    return result;
}
function getUniqueItemNames(orders) {
    const uniqueItems = new Set();
    orders.forEach(order => {
        if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
                if (item.name) {
                    uniqueItems.add(item.name);
                }
            });
        }
    });
    return Array.from(uniqueItems).join(', ');
}
function groupOrdersBySummary(orders) {
    console.log('Grouping orders for summary');
    const groups = orders.reduce((groups, order) => {
        const date = new Date(order.dateTime).toLocaleDateString();
        const key = `${date}|${order.partyName}`;
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(order);
        console.log('Added order to group:', key, 'Group size:', groups[key].length, 'Total Quantity:', order.totalQuantity);
        return groups;
    }, {});
    console.log('Grouping complete. Total groups:', Object.keys(groups).length);
    return groups;
}
function groupOrdersByParty(orders) {
    return orders.reduce((groups, order) => {
        if (!groups[order.partyName]) {
            groups[order.partyName] = [];
        }
        groups[order.partyName].push(order);
        return groups;
    }, {});
}
function getItemsSummary(items) {
    if (!items || !Array.isArray(items)) return 'No items';
    
    return items.map(item => 
        `${item.name} (${Object.entries(item.quantities || {}).map(([size, qty]) => `${size}/${qty}`).join(', ')})`
    ).join('; ');
}

function getTotalQuantity(items) {
    console.log('Calculating total quantity for items:', items);
    if (!items || !Array.isArray(items)) {
        console.warn('Invalid items array:', items);
        return 0;
    }
    
    return items.reduce((total, item, index) => {
        console.log(`Processing item ${index}:`, item);
        if (!item || typeof item !== 'object') {
            console.warn(`Invalid item at index ${index}:`, item);
            return total;
        }
        
        const itemTotal = Object.values(item.quantities || {}).reduce((sum, qty) => {
            const parsedQty = parseInt(qty);
            console.log(`Quantity: ${qty}, Parsed: ${parsedQty}`);
            return sum + (isNaN(parsedQty) ? 0 : parsedQty);
        }, 0);
        
        console.log(`Total quantity for item ${index}:`, itemTotal);
        return total + itemTotal;
    }, 0);
}
function updateOrderState(orderId, itemName, color, size, srqValue) {
    console.log(`Updating order state: Order=${orderId}, Item=${itemName}, Color=${color}, Size=${size}, SRQ=${srqValue}`);
    
    if (!currentOrders[orderId]) {
        currentOrders[orderId] = {};
    }
    if (!currentOrders[orderId][itemName]) {
        currentOrders[orderId][itemName] = {};
    }
    if (!currentOrders[orderId][itemName][color]) {
        currentOrders[orderId][itemName][color] = {};
    }
    currentOrders[orderId][itemName][color][size] = srqValue;

    console.log('Current state of order:', JSON.stringify(currentOrders[orderId], null, 2));

    // Update IndexedDB and Firebase
    saveSRQValue(orderId, itemName, color, size, srqValue);
}


//DELETE
function openDeleteModal1(orderId) {
    console.log('openDeleteModal1 called with orderId:', orderId);
    const modalId = `deleteConfirmationDialog-${orderId}`;
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'delete-confirmation-dialog';
    
    const reasonGroupName = `deleteReason-${orderId}`;
    const customReasonId = `customDeleteReason-${orderId}`;
    const confirmDeleteId = `confirmDelete-${orderId}`;
    const cancelDeleteId = `cancelDelete-${orderId}`;

    modal.innerHTML = `
        <div class="delete-confirmation-dialog-content">
            <h2>Delete Order</h2>
            <p>Please select a reason for deleting this order:</p>
            <div class="quick-reasons">
                <label><input type="checkbox" name="${reasonGroupName}" value="Order placed by mistake"> Order placed by mistake</label>
                <label><input type="checkbox" name="${reasonGroupName}" value="Duplicate order"> Duplicate order</label>
                <label><input type="checkbox" name="${reasonGroupName}" value="Order cancelled by party"> Order cancelled by party</label>
                <label><input type="checkbox" name="${reasonGroupName}" value="Order cancelled due to no stock in company"> Order cancelled due to no stock in company</label>
            </div>
            <textarea id="${customReasonId}" placeholder="Or enter your own reason here"></textarea>
            <div class="modal-actions">
                <button id="${confirmDeleteId}">Delete</button>
                <button id="${cancelDeleteId}">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    console.log('Delete confirmation dialog appended to body:', modalId);

    // Make sure the modal is visible
    modal.classList.add('show');

    document.getElementById(confirmDeleteId).addEventListener('click', () => {
        console.log('Confirm delete clicked');
        const selectedReasons = Array.from(document.querySelectorAll(`input[name="${reasonGroupName}"]:checked`)).map(input => input.value);
        const customReason = document.getElementById(customReasonId).value;
        const deleteReason = selectedReasons.length > 0 ? selectedReasons.join(', ') : customReason;
        document.body.removeChild(modal);
        openDeleteModal2(orderId, deleteReason);
    });

    document.getElementById(cancelDeleteId).addEventListener('click', () => {
        console.log('Cancel delete clicked');
        document.body.removeChild(modal);
    });
}

function openDeleteModal2(orderId, deleteReason) {
    const modalId = `deleteFinalConfirmationDialog-${orderId}`;
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'delete-confirmation-dialog';

    const confirmFinalDeleteId = `confirmFinalDelete-${orderId}`;
    const cancelFinalDeleteId = `cancelFinalDelete-${orderId}`;

    modal.innerHTML = `
        <div class="delete-confirmation-dialog-content">
            <h2>Confirm Delete</h2>
            <p>Are you sure you want to delete this order?</p>
            <p>The order will remain in the Delete section for 30 days and then be automatically deleted.</p>
            <div class="modal-actions">
                <button id="${confirmFinalDeleteId}">Yes, Delete</button>
                <button id="${cancelFinalDeleteId}">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.classList.add('show');

    document.getElementById(confirmFinalDeleteId).addEventListener('click', () => {
        deleteOrder(orderId, deleteReason);
        document.body.removeChild(modal);
        showDeleteConfirmation();
    });

    document.getElementById(cancelFinalDeleteId).addEventListener('click', () => {
        document.body.removeChild(modal);
    });
}


function showDeleteConfirmation() {
    const modal = document.createElement('div');
    modal.id = 'deleteConfirmationModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Order Deleted</h2>
            <p>The order has been successfully deleted.</p>
            <button id="closeDeleteConfirmation">Close</button>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('closeDeleteConfirmation').addEventListener('click', () => {
        document.body.removeChild(modal);
        loadPendingOrders(); // Refresh the orders section
    });
}
function deleteOrder(orderId, deleteReason) {
    const orderRef = firebase.database().ref('orders').child(orderId);
    orderRef.once('value')
        .then(snapshot => {
            const order = snapshot.val();
            if (order) {
                const deletedOrderRef = firebase.database().ref('deletedOrders').child(orderId);
                return deletedOrderRef.set({
                    ...order,
                    deleteReason: deleteReason,
                    deleteDate: new Date().toISOString(),
                    deletedFrom: 'Pending',
                    scheduledDeletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
                }).then(() => {
                    return orderRef.remove();
                });
            }
        })
        .then(() => {
            console.log(`Order ${orderId} moved to deleted orders from pending section`);
            window.location.reload(); // Refresh the page after the order is deleted
        })
        .catch(error => {
            console.error("Error deleting order: ", error);
        });
}

// Add this function to check and delete expired orders automatically
function checkAndDeleteExpiredOrders() {
    const now = new Date();
    firebase.database().ref('deletedOrders').once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                const promises = [];
                snapshot.forEach(childSnapshot => {
                    const order = childSnapshot.val();
                    const deletionDate = new Date(order.scheduledDeletionDate);
                    if (deletionDate <= now) {
                        // Order has expired, delete it completely
                        promises.push(
                            firebase.database().ref('deletedOrders').child(childSnapshot.key).remove()
                                .then(() => {
                                    console.log(`Automatically deleted order ${childSnapshot.key} as it passed 30 days`);
                                })
                        );
                    }
                });
                return Promise.all(promises);
            }
        })
        .catch(error => {
            console.error("Error checking for expired orders: ", error);
        });
}


function loadDeletedOrders() {
    const deletedOrdersContainer = document.getElementById('deletedOrders');
    deletedOrdersContainer.innerHTML = '<h4>Deleted Orders</h4>';

    firebase.database().ref('deletedOrders').once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                const deletedOrders = [];
                snapshot.forEach(childSnapshot => {
                    const order = childSnapshot.val();
                    order.id = childSnapshot.key;
                    deletedOrders.push(order);
                });
                displayDeletedOrders(deletedOrders, deletedOrdersContainer);
            } else {
                deletedOrdersContainer.innerHTML += '<p>No deleted orders found.</p>';
            }
        })
        .catch(error => {
            console.error("Error loading deleted orders: ", error);
            deletedOrdersContainer.innerHTML += '<p>Error loading deleted orders. Please try again.</p>';
        });
}
function displayDeletedOrders(orders, container) {
    // Clear existing content
    container.innerHTML = '<h4>Deleted Orders</h4>';

    // Sort orders by deleteDate (newest first)
    orders.sort((a, b) => {
        const dateA = new Date(a.deleteDate || 0);
        const dateB = new Date(b.deleteDate || 0);
        return dateB - dateA;
    });

    const displayedOrderIds = new Set();

    orders.forEach(order => {
        if (displayedOrderIds.has(order.id)) {
            console.warn(`Duplicate order detected: ${order.id}`);
            return;
        }
        displayedOrderIds.add(order.id);

        const orderDiv = document.createElement('div');
        orderDiv.className = 'deleted-order-container mb-4 p-3 border rounded';
        orderDiv.dataset.orderId = order.id;

        const deletionDate = new Date(order.scheduledDeletionDate);
        const deleteDate = order.deleteDate ? new Date(order.deleteDate) : null;
        const daysUntilDeletion = Math.ceil((deletionDate - new Date()) / (1000 * 60 * 60 * 24));

        // Generate HTML for items in table format
        let itemsHtml = '';
        if (order.items && order.items.length > 0) {
            itemsHtml = `
            <div class="order-items mt-3">
                <h5 class="mb-3">Items:</h5>
                <div class="table-responsive">
                    <table class="table table-bordered table-sm">
                        <thead class="table-light">
                            <tr>
                                <th>Item Name</th>
                                <th>Color</th>
                                <th>Size Quantities</th>
                            </tr>
                        </thead>
                        <tbody>`;

            order.items.forEach(item => {
                if (item.colors && Object.keys(item.colors).length > 0) {
                    const colors = Object.keys(item.colors);
                    let isFirstColor = true;
                    
                    colors.forEach(color => {
                        // Add separator line between colors of same item
                        if (!isFirstColor) {
                            itemsHtml += `
                            <tr class="color-separator">
                                <td colspan="3"><hr class="m-0"></td>
                            </tr>`;
                        }
                        isFirstColor = false;
                        
                        const sizes = item.colors[color];
                        const sizeQuantities = Object.entries(sizes).map(
                            ([size, qty]) => `<span class="size-qty">${size}:${qty}</span>`
                        ).join(' ');
                        
                        itemsHtml += `
                        <tr>
                            <td><strong>${item.name || 'N/A'}</strong></td>
                            <td>
                                <span class="color-badge" style="background-color: ${getColorHex(color)}">
                                    ${color}
                                </span>
                            </td>
                            <td>${sizeQuantities}</td>
                        </tr>`;
                    });
                } else {
                    itemsHtml += `
                    <tr>
                        <td><strong>${item.name || 'N/A'}</strong></td>
                        <td>N/A</td>
                        <td>N/A</td>
                    </tr>`;
                }
            });
            
            itemsHtml += `</tbody></table></div></div>`;
        }

        // Format the delete date for display
        const formattedDeleteDate = deleteDate ? 
            `${deleteDate.toLocaleDateString()} ${deleteDate.toLocaleTimeString()}` : 
            'Unknown deletion time';

        orderDiv.innerHTML = `
            <div class="order-header mb-3">
                <div class="d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Order No. ${order.orderNumber || 'N/A'}</h5>
                    <span class="badge ${daysUntilDeletion <= 5 ? 'bg-danger' : 'bg-secondary'}">
                        Days Left: ${daysUntilDeletion}
                    </span>
                </div>
                <div class="order-meta mt-2">
                    <div><strong>Party:</strong> ${order.partyName || 'N/A'}</div>
                    <div><strong>Deleted From:</strong> ${order.deletedFrom || 'Unknown'}</div>
                    <div><strong>Deleted On:</strong> ${formattedDeleteDate}</div>
                    <div><strong>Reason:</strong> ${order.deleteReason || 'N/A'}</div>
                    <div><strong>Total Qty:</strong> ${order.totalQuantity || 0}</div>
                </div>
            </div>
            ${itemsHtml}
            <div class="order-actions mt-3 d-flex justify-content-end gap-2">
                <button class="btn btn-sm btn-outline-primary revert-to-pending" data-order-id="${order.id}">
                    <i class="bi bi-arrow-counterclockwise"></i> Revert
                </button>
                <button class="btn btn-sm btn-outline-danger permanent-delete" data-order-id="${order.id}">
                    <i class="bi bi-trash-fill"></i> Delete Permanently
                </button>
            </div>
            <style>
                .color-badge {
                    display: inline-block;
                    padding: 2px 8px;
                    border-radius: 12px;
                    margin: 2px 0;
                    color: white;
                    font-weight: bold;
                    text-shadow: 1px 1px 1px rgba(0,0,0,0.3);
                }
                .size-qty {
                    display: inline-block;
                    padding: 2px 6px;
                    margin: 2px;
                    border-radius: 4px;
                    border: 1px solid #dee2e6;
                }
                .color-separator hr {
                    border-top: 1px dashed #aaa;
                    margin: 3px 0;
                }
                .table th {
                    border-bottom-width: 2px;
                }
            </style>
        `;

        container.appendChild(orderDiv);

        // Add event listeners
        orderDiv.querySelector('.permanent-delete').addEventListener('click', () => permanentlyDeleteOrder(order.id));
        orderDiv.querySelector('.revert-to-pending').addEventListener('click', () => revertToPending(order.id));
    });

    console.log(`Displayed ${displayedOrderIds.size} unique deleted orders`);
}
// Helper function to get color hex codes (simplified version)
function getColorHex(colorName) {
    const colorMap = {
        'red': '#dc3545',
        'blue': '#0d6efd',
        'green': '#198754',
        'yellow': '#ffc107',
        'black': '#212529',
        'white': '#f8f9fa',
        'gray': '#6c757d',
        'pink': '#d63384',
        'orange': '#fd7e14',
        'purple': '#6f42c1'
    };
    return colorMap[colorName.toLowerCase()] || '#6c757d'; // Default to gray if not found
}
function permanentlyDeleteOrder(orderId) {
    if (confirm('Are you sure you want to permanently delete this order? This action cannot be undone.')) {
        firebase.database().ref('deletedOrders').child(orderId).remove()
            .then(() => {
                console.log(`Order ${orderId} permanently deleted`);
                loadDeletedOrders(); // Refresh the deleted orders section
            })
            .catch(error => {
                console.error("Error permanently deleting order: ", error);
            });
    }
}

function revertToPending(orderId) {
    const deletedOrderRef = firebase.database().ref('deletedOrders').child(orderId);
    deletedOrderRef.once('value')
        .then(snapshot => {
            const order = snapshot.val();
            if (order) {
                // Move the order back to the pending orders section
                const pendingOrderRef = firebase.database().ref('orders').child(orderId);
                return pendingOrderRef.set({
                    ...order,
                    status: 'Pending' // Ensure the status is set back to Pending
                }).then(() => {
                    // Remove the order from the deleted orders section
                    return deletedOrderRef.remove();
                });
            }
        })
        .then(() => {
            console.log(`Order ${orderId} reverted to pending`);
            loadDeletedOrders(); // Refresh the deleted orders section
            loadPendingOrders(); // Refresh the pending orders section
        })
        .catch(error => {
            console.error("Error reverting order to pending: ", error);
        });
}
//FILTER
function loadPartyNames() {
    const partyNameList = document.getElementById('partyNameList');
    partyNameList.innerHTML = '';

    getOrdersFromIndexedDB()
        .then(orders => {
            if (orders && orders.length > 0) {
                const partyNames = new Set();
                orders.forEach(order => {
                    if (order.status === 'Pending' && order.partyName && calculateTotalQuantityForOrder(order) > 0) {
                        partyNames.add(order.partyName);
                    }
                });
                
                if (partyNames.size > 0) {
                    partyNames.forEach(partyName => {
                        const button = document.createElement('button');
                        button.textContent = partyName;
                        button.classList.add('party-name-btn');
                        button.classList.toggle('selected', currentFilters.includes(partyName));
                        button.addEventListener('click', togglePartyNameSelection);
                        partyNameList.appendChild(button);
                    });
                } else {
                    partyNameList.innerHTML = '<p>No party names found for pending orders</p>';
                }
            } else {
                partyNameList.innerHTML = '<p>No orders found</p>';
            }
        })
        .catch(error => {
            console.error("Error loading party names: ", error);
            partyNameList.innerHTML = '<p>Error loading party names</p>';
        });
}


function togglePartyNameSelection(event) {
    event.target.classList.toggle('selected');
    updateSelectionCount();
}

function updateSelectionCount() {
    const selectedParties = document.querySelectorAll('.party-name-btn.selected');
    const selectionCountElement = document.getElementById('selectionCount');
    selectionCountElement.textContent = `${selectedParties.length} parties selected`;
}

function selectAllPartyNames() {
    const partyNameButtons = document.querySelectorAll('.party-name-btn');
    partyNameButtons.forEach(button => button.classList.add('selected'));
    updateSelectionCount();
}

function deselectAllPartyNames() {
    const partyNameButtons = document.querySelectorAll('.party-name-btn');
    partyNameButtons.forEach(button => button.classList.remove('selected'));
    updateSelectionCount();
}

function applyFilters() {
    currentFilters = Array.from(document.querySelectorAll('.party-name-btn.selected')).map(btn => btn.textContent);
    
    if (currentFilters.length === 0) {
        showMessage('No filter selected');
        return;
    }
    
    document.getElementById('filterButton').classList.toggle('active', currentFilters.length > 0);
    closeFilterModal(true);
    updateClearFiltersButtonVisibility();
    loadPendingOrders(); // Reload orders with new filters
}

function clearFilters() {
    currentFilters = [];
    document.getElementById('filterButton').classList.remove('active');
    const partyNameButtons = document.querySelectorAll('.party-name-btn');
    partyNameButtons.forEach(button => button.classList.remove('selected'));
    updateSelectionCount();
    updateClearFiltersButtonVisibility();
    loadPendingOrders(); // Reload orders without filters
}

function handleOrderActions(e) {
    if (e.target.classList.contains('complete-order')) {
        markForBilling(e.target.getAttribute('data-order-id'));
    } else if (e.target.classList.contains('view-order')) {
        viewOrderDetails(e.target.getAttribute('data-order-id'));
    }
}

function openFilterModal() {
    const filterModal = document.getElementById('filterModal4');
    filterModal.style.display = 'block';
    loadPartyNames();
}

function closeFilterModal(applyFilter = false) {
    const filterModal = document.getElementById('filterModal4');
    filterModal.style.display = 'none';
    
    if (!applyFilter) {
        // Reset the UI to match currentFilters
        const partyNameButtons = document.querySelectorAll('.party-name-btn');
        partyNameButtons.forEach(button => {
            button.classList.toggle('selected', currentFilters.includes(button.textContent));
        });
    }
}



function showMessage(message) {
    const messageElement = document.getElementById('noFilterSelectedMessage');
    messageElement.textContent = message;
    messageElement.style.display = 'block';
    setTimeout(() => {
        messageElement.style.display = 'none';
    }, 2000);
}

function handleViewToggle() {
    loadPendingOrders();
}
// New function to update Clear Filters button visibility
function updateClearFiltersButtonVisibility() {
    const clearFiltersButton = document.getElementById('clearFiltersButton');
    if (currentFilters.length > 0) {
        clearFiltersButton.style.display = 'inline-block';
    } else {
        clearFiltersButton.style.display = 'none';
    }
}

function getExpiryStatus(expiryDate) {
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysRemaining = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    
    if (daysRemaining <= 0) {
        return {
            status: 'expired',
            class: 'expiry-expired',
            label: 'Expired',
            icon: '⏱️',
            days: 0,
            percentage: 0
        };
    } else if (daysRemaining <= 5) {
        const percentage = Math.min(100, Math.max(0, (daysRemaining / 5) * 100));
        return {
            status: 'critical',
            class: 'expiry-critical',
            label: `Critical (${daysRemaining}d)`,
            icon: '⚠️',
            days: daysRemaining,
            percentage: percentage
        };
    } else if (daysRemaining <= 10) {
        const percentage = Math.min(100, Math.max(0, (daysRemaining / 10) * 100));
        return {
            status: 'warning',
            class: 'expiry-warning',
            label: `Warning (${daysRemaining}d)`,
            icon: '🔔',
            days: daysRemaining,
            percentage: percentage
        };
    } else {
        const percentage = Math.min(100, Math.max(0, (daysRemaining / 30) * 100));
        return {
            status: 'normal',
            class: 'expiry-normal',
            label: `Normal (${daysRemaining}d)`,
            icon: '✅',
            days: daysRemaining,
            percentage: percentage
        };
    }
}
