## 2024-05-18 - Bilingual aria-labels and focus rings on utility buttons
**Learning:** Found an accessibility opportunity where the `ThemeToggle` button was missing the `focus-ring` class for keyboard navigation indicators. Also, it only provided English `aria-label`s. Since the application supports both Arabic and English, utilizing the custom `useLang` hook to translate `aria-label` dynamically using `t("AR", "EN")` improves screen-reader compatibility for users.
**Action:** When working on UI components, ensure that all interactive buttons, particularly utility or icon-only buttons, have the `focus-ring` class and utilize `useLang` to translate their `aria-label` appropriately for accessibility.

## 2024-05-18 - [Tab Accessibility]
**Learning:** Recharts doesn't provide built-in ARIA roles for custom tab implementations used alongside its charts. Wrapping custom buttons in a \`role="tablist"\` and using a \`tabIndex\` roaming pattern is essential for keyboard and screen reader accessibility.
**Action:** Next time I implement or encounter custom tabs, I will ensure they use the roving \`tabIndex\` pattern (one tab has \`tabIndex={0}\`, the rest \`tabIndex={-1}\`), handle arrow key navigation to move focus, and use proper ARIA roles (\`tablist\`, \`tab\`, \`aria-selected\`).
