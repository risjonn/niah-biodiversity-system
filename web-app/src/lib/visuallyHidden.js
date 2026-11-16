// sx for text that screen readers read but that isn't shown, e.g. "Loading users" next to a
// skeleton, or what a sidebar badge's number counts
export const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  m: '-1px',
  p: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}
