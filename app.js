'use strict';

const grid = document.querySelector('#product-grid');
const catalogStatus = document.querySelector('#catalog-status');
const selectedProducts = document.querySelector('#selected-products');
const form = document.querySelector('#inquiry-form');
const formStatus = document.querySelector('#form-status');
const submitButton = form.querySelector('[type="submit"]');
const selected = new Map();
let catalog = [];

function renderSelected() {
  selectedProducts.replaceChildren();
  if (!selected.size) {
    const note = document.createElement('span');
    note.textContent = 'Select products above, or leave this blank for a general enquiry.';
    selectedProducts.append(note);
    return;
  }
  for (const [id, name] of selected) {
    const chip = document.createElement('span');
    chip.className = 'selected-product';
    chip.append(document.createTextNode(name));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.addEventListener('click', () => {
      selected.delete(id);
      renderSelected();
      renderCatalog();
    });
    chip.append(remove);
    selectedProducts.append(chip);
  }
}

function renderCatalog() {
  grid.replaceChildren();
  for (const [index, product] of catalog.entries()) {
    const article = document.createElement('article');
    article.className = 'product-item';
    const meta = document.createElement('div');
    meta.className = 'product-meta';
    const category = document.createElement('span');
    category.textContent = product.category;
    const number = document.createElement('span');
    number.className = 'product-index';
    number.textContent = String(index + 1).padStart(2, '0');
    meta.append(category, number);

    const title = document.createElement('h3');
    title.textContent = product.name;
    const note = document.createElement('p');
    note.textContent = product.note;
    const packs = document.createElement('div');
    packs.className = 'product-packs';
    packs.textContent = `Retail and wholesale: ${product.packSizes.join(' · ')}`;
    const button = document.createElement('button');
    button.className = 'product-select';
    button.type = 'button';
    button.textContent = selected.has(product.id) ? 'Added to enquiry ✓' : 'Add to enquiry +';
    button.setAttribute('aria-pressed', String(selected.has(product.id)));
    button.addEventListener('click', () => {
      if (selected.has(product.id)) selected.delete(product.id);
      else selected.set(product.id, product.name);
      renderSelected();
      renderCatalog();
    });
    article.append(meta, title, note, packs, button);
    grid.append(article);
  }
}

async function loadCatalog() {
  try {
    const response = await fetch('/api/products', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('The catalogue could not be loaded.');
    const data = await response.json();
    if (!Array.isArray(data.products)) throw new Error('The catalogue response was not valid.');
    catalog = data.products;
    renderCatalog();
    catalogStatus.textContent = `${catalog.length} blends available for wholesale and food-service enquiries.`;
  } catch {
    catalogStatus.textContent = 'The catalogue is temporarily unavailable. Please contact sales directly.';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formStatus.textContent = '';
  formStatus.removeAttribute('data-state');
  if (!form.reportValidity()) return;

  const values = new FormData(form);
  const payload = {
    name: values.get('name').trim(),
    businessName: values.get('businessName').trim(),
    phone: values.get('phone').trim(),
    email: values.get('email').trim(),
    products: [...selected.keys()],
    quantity: values.get('quantity').trim(),
    city: values.get('city').trim(),
    message: values.get('message').trim(),
    website: values.get('website').trim()
  };
  if (payload.phone.replace(/\D/g, '').length < 10) {
    form.elements.phone.setCustomValidity('Enter a phone number with at least 10 digits.');
    form.elements.phone.reportValidity();
    form.elements.phone.setCustomValidity('');
    return;
  }

  submitButton.disabled = true;
  submitButton.firstChild.textContent = 'Sending… ';
  try {
    const response = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'We could not send your enquiry. Please try again.');
    formStatus.dataset.state = 'success';
    formStatus.textContent = result.status === 'accepted'
      ? 'Thank you. Your enquiry has been received.'
      : `Thank you. Your enquiry has been received. Reference: ${result.reference}.`;
    form.reset();
    selected.clear();
    renderSelected();
    renderCatalog();
  } catch (error) {
    formStatus.dataset.state = 'error';
    formStatus.textContent = error instanceof TypeError
      ? 'Could not reach the sales desk. Check your connection and try again, or call +91 79952 74737.'
      : error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.firstChild.textContent = 'Send enquiry ';
  }
});

const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-nav');
menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
  navigation.classList.toggle('is-open', !isOpen);
});
navigation.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('is-open');
  }
});
document.querySelector('#current-year').textContent = new Date().getFullYear();
renderSelected();
loadCatalog();
