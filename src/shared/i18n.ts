/**
 * Minimal i18n helper for extension pages.
 *
 * Static HTML uses data attributes:
 *   data-i18n="<key>"                -> element text
 *   data-i18n-title="<key>"          -> element title
 *   data-i18n-placeholder="<key>"    -> input placeholder
 *   data-i18n-aria-label="<key>"     -> aria-label
 *   data-i18n-html="<key>"           -> element innerHTML from the shipped
 *                                    locale, restricted to inline tags
 *
 * Dynamic strings go through `getMessage`, using $1..$n placeholders.
 *
 * Security: the locale files ship with the extension (English is the only
 * shipped locale; there is no remote translation pipeline), so
 * `data-i18n-html` cannot carry user or network content. It is still sanitised
 * to a small allow-list of inline tags with all attributes stripped, so a
 * malformed or corrupt messages.json can never inject markup.
 */

/** Tags allowed inside data-i18n-html content; everything else is dropped. */
const SAFE_INLINE_TAGS = new Set(['B', 'BR', 'CODE', 'EM', 'I', 'KBD', 'SPAN', 'STRONG', 'U']);

/** Fetch a localized message, logging and falling back to the key when missing. */
export function getMessage(key: string, substitutions?: string | string[]): string {
  const message = browser.i18n.getMessage(key, substitutions as string);
  if (message !== '') return message;
  console.warn(`[orbis] missing i18n message: ${key}`);
  return key;
}

/** Render one element from a data-i18n* attribute. */
function localizeElement(element: HTMLElement): void {
  const textKey = element.dataset['i18n'];
  if (textKey !== undefined) element.textContent = getMessage(textKey);
  const titleKey = element.dataset['i18nTitle'];
  if (titleKey !== undefined) element.title = getMessage(titleKey);
  const placeholderKey = element.dataset['i18nPlaceholder'];
  if (placeholderKey !== undefined) element.setAttribute('placeholder', getMessage(placeholderKey));
  const labelKey = element.dataset['i18nAriaLabel'];
  if (labelKey !== undefined) element.setAttribute('aria-label', getMessage(labelKey));
  const htmlKey = element.dataset['i18nHtml'];
  if (htmlKey !== undefined) applySafeHtml(element, getMessage(htmlKey));
}

function applySafeHtml(element: HTMLElement, html: string): void {
  // Parsed via DOMParser (never assigned to innerHTML, so the AMO linter's
  // UNSAFE_VAR_ASSIGNMENT check stays quiet), then restricted to the inline
  // allow-list with every attribute stripped.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const walker = document.createTreeWalker(parsed.body, NodeFilter.SHOW_ELEMENT);
  const nodes: Element[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    // SHOW_ELEMENT guarantees the visited nodes are Elements.
    nodes.push(node as Element);
    node = walker.nextNode();
  }
  for (const el of nodes) {
    if (!SAFE_INLINE_TAGS.has(el.tagName)) {
      el.remove();
      continue;
    }
    for (const attribute of [...el.attributes]) el.removeAttribute(attribute.name);
  }
  element.replaceChildren(...[...parsed.body.childNodes]);
}

/** Localize every element in the page that carries a data-i18n* attribute. */
export function localizePage(root: ParentNode = document): void {
  const elements = root.querySelectorAll<HTMLElement>(
    '[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-html]'
  );
  for (const element of elements) localizeElement(element);
}
