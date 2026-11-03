// The site's pages and links, shared by the header, the mobile menu and the footer.
// `to` is a route; `section` is an id on the page that the link scrolls to instead
// (about lives below the melon on the home page, contact is the footer on every page).

export const NAV = [
  { key: 'about', label: 'about', title: 'about me', to: '/', section: 'about' },
  { key: 'academics', label: 'academics', title: 'awards, honors & academics', to: '/academics' },
  { key: 'research', label: 'research', title: 'research & experience', to: '/research' },
  { key: 'projects', label: 'projects', title: 'projects & side quests', to: '/projects' },
  { key: 'ashwa', label: 'ashwa', title: 'ashwa racing', to: '/ashwa' },
  { key: 'drama', label: 'drama', title: 'drama', to: '/drama' },
  { key: 'leadership', label: 'leadership', title: 'leadership & volunteering', to: '/leadership' },
  { key: 'contact', label: 'contact', title: 'contact', section: 'contact' },
]

export const RESUME = {
  href: `${import.meta.env.BASE_URL}Aadi_Ramnani_Resume.pdf`,
  file: 'Aadi_Ramnani_Resume.pdf',
}

export const EMAIL = 'aadi.ramnani@gmail.com'

export const ELSEWHERE = [
  { key: 'linkedin', label: 'linkedin', href: 'https://www.linkedin.com/in/aadi-ramnani-493485202' },
  { key: 'github', label: 'github', href: 'https://github.com/ar061290' },
  { key: 'email', label: 'email', href: `mailto:${EMAIL}` },
]

export const PLACE = 'hyderabad, india'
