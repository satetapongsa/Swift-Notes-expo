import { useWindowDimensions } from 'react-native';

// Breakpoints shared by every screen.
export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1100,
};

// Widest a column of each kind may get, so lines stay readable on big screens.
export const MAX_WIDTH = {
  form: 440, // sign in / register
  reading: 760, // note editor, settings, single-column pages
  list: 1180, // note and folder grids
  sheet: 560, // bottom sheets become centred sheets
};

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isTablet = !isDesktop && width >= BREAKPOINTS.tablet;
  const isPhone = !isDesktop && !isTablet;

  // Note/folder grid columns.
  const columns = isDesktop ? 3 : isTablet ? 2 : 1;

  return {
    width,
    height,
    isPhone,
    isTablet,
    isDesktop,
    isWide: !isPhone,
    columns,
  };
}

// Centres a column and caps its width. Use on ScrollView contentContainerStyle or a wrapper View.
export function column(maxWidth) {
  return { width: '100%', maxWidth, alignSelf: 'center' };
}

// A wrapping row of equal columns. Put gridItem() on each child.
export function gridRow(gap) {
  return { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 };
}

export function gridItem(columns, gap) {
  return { width: `${100 / columns}%`, paddingHorizontal: gap / 2 };
}
