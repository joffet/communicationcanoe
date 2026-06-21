export const ADMIN_SEARCH_MIN_LENGTH = 2;

export function shouldRunAdminSearch(query: string): boolean {
  return query.trim().length >= ADMIN_SEARCH_MIN_LENGTH;
}

export function adminSearchToolbarIconToggle(
  searchOpen: boolean,
  setSearchOpen: (open: boolean) => void,
  setSearchInput: (value: string) => void,
) {
  if (searchOpen) {
    setSearchOpen(false);
    setSearchInput("");
  } else {
    setSearchOpen(true);
  }
}
