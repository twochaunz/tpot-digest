# Dashboard Polish v2 Design

## Fix 1: Hide engagement metrics in react-tweet

react-tweet 3.3.0 uses CSS Modules with hashed class names. The current selectors (`[data-testid="tweet-actions"]`, `.react-tweet-actions-row`) don't match anything. Use `[class*="actions"]` attribute selector which matches hashed module class names.

## Fix 2: Padding between header and feeds

Add top padding to DayFeedPanel container so feeds don't butt up against the header.

## Fix 3: Search to right side + Cmd+K

Move search input from left header section to right section. Add Cmd+K (Mac) / Ctrl+K keyboard shortcut to focus. Show "Cmd+K" hint badge in the input when empty and unfocused.

## Fix 4: Center side panels vertically

Change side panel `transformOrigin` from `center top` to `center center` so scaled-down side feeds are vertically centered in the carousel body.
