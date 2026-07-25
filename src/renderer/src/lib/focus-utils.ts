export function isEditableElement(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)
  )
}

export function hasFocusedEditableElement(): boolean {
  return isEditableElement(document.activeElement)
}
