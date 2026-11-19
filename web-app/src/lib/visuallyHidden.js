// sx for text that screen readers read but that isn't shown, e.g. "Loading users" next to a
// skeleton, or what a sidebar badge's number counts.
// The sizes are px strings on purpose: in sx a number from 0 to 1 is a fraction, so `width: 1`
// would be 100% of the nearest positioned ancestor (the whole page area). The text stays clipped
// out of sight, but that page-sized box would still stretch the page's scroll area right and down.
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  m: '-1px',
  p: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}
