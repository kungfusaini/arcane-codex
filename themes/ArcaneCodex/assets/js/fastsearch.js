let fuse; // holds our search engine
let searchData = []; // holds the original search data
let resList, catList, tagList, sInput, postsResults;
let resultsAvailable = false;
let currentFilter = 'posts'; // current filter state: 'posts', 'categories', 'tags'
let allCategories = [];
let allTags = [];

// Function to strip HTML tags (like Hugo's plainify)
function stripHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || '';
}

// load our search index
window.onload = function () {
    // Initialize DOM element references
    resList = document.getElementById('searchResults');
    catList = document.getElementById('categoriesResults');
    tagList = document.getElementById('tagsResults');
    sInput = document.getElementById('searchInput');
    postsResults = document.getElementById('postsResults');
    
    initializeFilterToggles();
    updateContentDisplay();
    
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                let data = JSON.parse(xhr.responseText);
                if (data) {
                    searchData = data;
                    // Extract all unique categories and tags from the data
                    let categorySet = new Set();
                    let tagSet = new Set();
                    
                    data.forEach(item => {
                        if (item.categories) {
                            item.categories.forEach(cat => categorySet.add(cat));
                        }
                        if (item.tags) {
                            item.tags.forEach(tag => tagSet.add(tag));
                        }
                    });
                    
                    allCategories = Array.from(categorySet).sort();
                    allTags = Array.from(tagSet).sort();
                    
                    // fuse.js options; check fuse.js website for details
                    let options = {
                        distance: 100,
                        threshold: 0.4,
                        ignoreLocation: true,
                        keys: [
                            'title',
                            'permalink',
                            'summary',
                            'content',
                            'categories',
                            'tags'
                        ]
                    };
                    
                    fuse = new Fuse(data, options); // build the index from the json file
                    
                    // Setup search input event listeners after DOM elements are ready
                    setupSearchInput();
                    
                    // Trigger initial search to show all posts
                    if (currentFilter === 'posts') {
                        performSearch();
                    }
                }
            }
        }
    };
    xhr.open('GET', "../index.json");
    xhr.send();
}

// Filter toggle functionality
function initializeFilterToggles() {
    const filterButtons = document.querySelectorAll('[data-filter]');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Update active state
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Update current filter
            currentFilter = this.getAttribute('data-filter');
            
            // Show/hide appropriate content
            updateContentDisplay();
        });
    });
}

// Update which content section is visible
function updateContentDisplay() {
    const searchbox = document.getElementById('searchbox');
    const categoriesDisplay = document.getElementById('categoriesDisplay');
    const tagsDisplay = document.getElementById('tagsDisplay');
    
    // Always show searchbox
    if (searchbox) searchbox.style.display = 'block';
    
    // Hide all results sections first with fade
    if (postsResults) postsResults.classList.add('fade-hidden');
    if (categoriesDisplay) categoriesDisplay.classList.add('fade-hidden');
    if (tagsDisplay) tagsDisplay.classList.add('fade-hidden');
    
    // Clear any existing content to remove event listeners
    if (resList) resList.innerHTML = '';
    if (catList) catList.innerHTML = '';
    if (tagList) tagList.innerHTML = '';
    
    // Show the appropriate results section with fade
    switch (currentFilter) {
        case 'posts':
            if (postsResults) {
                setTimeout(() => postsResults.classList.remove('fade-hidden'), 10);
                // Always trigger search for posts (shows all if no query)
                performSearch();
            }
            break;
        case 'categories':
            if (categoriesDisplay) {
                setTimeout(() => categoriesDisplay.classList.remove('fade-hidden'), 10);
                // Always trigger search for categories (shows all if no query)
                performCategoriesSearch(sInput ? sInput.value.trim().toLowerCase() : '');
            }
            break;
        case 'tags':
            if (tagsDisplay) {
                setTimeout(() => tagsDisplay.classList.remove('fade-hidden'), 10);
                // Always trigger search for tags (shows all if no query)
                performTagsSearch(sInput ? sInput.value.trim().toLowerCase() : '');
            }
            break;
    }
}

function shouldShowResult(item) {
    switch (currentFilter) {
        case 'posts':
            return true; // All search results are posts
        case 'categories':
            return item.categories && item.categories.length > 0;
        case 'tags':
            return item.tags && item.tags.length > 0;
        default:
            return true;
    }
}

function formatCategories(categories) {
    if (!categories || categories.length === 0) return '';
    return categories.map(cat => 
        `<a href="/categories/${cat.toLowerCase()}/" class="post-category">${cat}</a>`
    ).join(' ');
}

function formatTags(tags) {
    if (!tags || tags.length === 0) return '';
    return tags.map(tag => 
        `<a href="/tags/${tag.toLowerCase()}/" class="post-tag">${tag}</a>`
    ).join(' ');
}

function performSearch() {
    if (!sInput || !resList) return;
    
    const query = sInput.value.trim().toLowerCase();
    
    if (currentFilter === 'posts') {
        if (!fuse) return;
        
        let results;
        if (query) {
            // Search with query
            results = fuse.search(query);
        } else {
            // Show all posts when no query
            results = searchData.map((doc, index) => ({item: doc, refIndex: index}));
        }
        
        if (results.length !== 0) {
            let resultSet = '';
            
            for (let item in results) {
                const result = results[item].item;
                
                if (shouldShowResult(result)) {
                    let metaParts = [];
                    
                    // Add date if present
                    if (result.date) {
                        const date = new Date(result.date);
                        const formattedDate = date.toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                        });
                        metaParts.push(`<span title="${result.date}">${formattedDate}</span>`);
                    }
                    
                    // Add reading time if present
                    if (result.readingTime) {
                        metaParts.push(`<span>${result.readingTime} min</span>`);
                    }
                    
                    // Add categories if present
                    if (result.categories && result.categories.length > 0) {
                        const categories = result.categories.map(cat => 
                            `<a href="/categories/${cat.toLowerCase()}/" class="post-category">${cat}</a>`
                        ).join(' ');
                        metaParts.push(categories);
                    }
                    
                    // Add tags if present
                    if (result.tags && result.tags.length > 0) {
                        const tags = result.tags.map(tag => 
                            `<a href="/tags/${tag.toLowerCase()}/" class="post-tag">${tag}</a>`
                        ).join(' ');
                        metaParts.push(`<span class="post-tags-container">${tags}</span>`);
                    }
                    
                    const metaContent = metaParts.join('&nbsp;·&nbsp;');
                    
                    resultSet += `<article class="post-entry">
                        <header class="entry-header">
                            <h2>${result.title}</h2>
                        </header>
                        ${result.summary ? `<div class="entry-content">
                            <p>${stripHtml(result.summary)}${result.summary.endsWith('...') ? '' : '...'}</p>
                        </div>` : ''}
                        <a href="${result.permalink}" aria-label="${result.title}" class="entry-link"></a>
                        ${metaContent ? `<footer class="entry-footer">${metaContent}</footer>` : ''}
                    </article>`;
                }
            }
            
            resList.innerHTML = resultSet;
            resultsAvailable = true;
        } else {
            resultsAvailable = false;
            resList.innerHTML = '';
        }
    } else if (currentFilter === 'categories') {
        performCategoriesSearch(query);
    } else if (currentFilter === 'tags') {
        performTagsSearch(query);
    }
}

function performCategoriesSearch(query) {
    if (!catList) return;
    
    const matchingCategories = query ? 
        allCategories.filter(cat => cat.toLowerCase().includes(query)) : 
        allCategories;
    
    if (matchingCategories.length > 0) {
        let resultSet = '';
        matchingCategories.forEach(category => {
            const count = getCategoryPostCount(category);
            resultSet += `<li>
                <a href="/categories/${category.toLowerCase()}/">${category} <sup><strong><sup>${count}</sup></strong></sup></a>
            </li>`;
        });
        catList.innerHTML = resultSet;
    } else {
        catList.innerHTML = '';
    }
}

function performTagsSearch(query) {
    if (!tagList) return;
    
    const matchingTags = query ? 
        allTags.filter(tag => tag.toLowerCase().includes(query)) : 
        allTags;
    
    if (matchingTags.length > 0) {
        let resultSet = '';
        matchingTags.forEach(tag => {
            const count = getTagPostCount(tag);
            resultSet += `<li>
                <a href="/tags/${tag.toLowerCase()}/">${tag} <sup><strong><sup>${count}</sup></strong></sup></a>
            </li>`;
        });
        tagList.innerHTML = resultSet;
    } else {
        tagList.innerHTML = '';
    }
}

function getCategoryPostCount(category) {
    // Count posts that have this category
    let count = 0;
    if (fuse) {
        const allPosts = fuse._docs || [];
        allPosts.forEach(post => {
            if (post.categories && post.categories.includes(category)) {
                count++;
            }
        });
    }
    return count;
}

function getTagPostCount(tag) {
    // Count posts that have this tag
    let count = 0;
    if (fuse) {
        const allPosts = fuse._docs || [];
        allPosts.forEach(post => {
            if (post.tags && post.tags.includes(tag)) {
                count++;
            }
        });
    }
    return count;
}

function reset() {
    resultsAvailable = false;
    if (resList) resList.innerHTML = '';
    if (sInput) sInput.value = ''; // clear inputbox and searchResults
    if (sInput) sInput.focus(); // shift focus to input box
}

// execute search as each character is typed
function setupSearchInput() {
    if (sInput) {
        sInput.onkeyup = function (e) {
            performSearch();
        }

        sInput.addEventListener('search', function (e) {
            // clicked on x
            if (!this.value) reset()
        })
    }
}