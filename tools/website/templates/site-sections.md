# Website Section Guide by Industry

Use this to inform what sections to generate for each client site.
All sites: single HTML file + optional pages (about.html, menu.html, etc.).
Stack: HTML5 + Tailwind CSS CDN + vanilla JS. No build step. Netlify-ready.
Always include: Netlify Forms contact form, basic SEO meta tags, Open Graph tags.

## Universal sections (every site)
1. **Nav** — logo (text), links, mobile hamburger
2. **Hero** — full-width, gradient or solid background, headline, subheadline, CTA button
3. **Social proof** — Google/Yelp review stars (static, pulled from lead data)
4. **Contact / Footer** — address, phone, hours, Google Maps embed, copyright
5. **Netlify Form** — `<form name="contact" netlify>` for lead capture

## Restaurant / Cafe / Bar
Sections: Hero → About / Story → Menu Highlights → Gallery → Hours & Location → Reserve / Order CTA
- Menu: styled as a card grid, or linked PDF
- CTA: "Reserve a Table" (Calendly/OpenTable embed or tel: link), "Order Online" (links to DoorDash/Uber if present)
- Colors: warm (amber, red, cream) for casual; elegant (dark, gold) for fine dining

## Auto Shop / Dealership
Sections: Hero → Services → Why Us → Request a Quote form → Gallery → Contact
- Services: grid of service tiles with icons (Oil Change, Brakes, Tires, etc.)
- Quote form: Year/Make/Model + service type
- Colors: navy/gray/orange (mechanic vibe) or clean white/blue (professional)

## Real Estate Agency / Agent
Sections: Hero → Featured Listings → About the Agent → Services → Testimonials → Contact
- Listings: card grid with placeholder for property photo, price, beds/baths, address
- IDX embed note: mention Zillow/MLS embed options
- CTA: "Schedule a Showing" Calendly link
- Colors: navy/white/gold (trust + premium)

## Salon / Barbershop / Spa
Sections: Hero → Services & Pricing → Meet the Team → Gallery → Book Now → Contact
- Services: pricing table (cut, color, highlights, etc.)
- Book Now: Vagaro / StyleSeat / Booksy embed link
- Gallery: CSS masonry grid (placeholder for photos)
- Colors: blush/black/gold for spa; clean white/mint for modern salon

## Medical / Dental / Veterinary
Sections: Hero → Services → Meet the Doctor → Insurance → New Patient form → Contact
- New Patient form: Netlify Forms (name, DOB, insurance, reason for visit)
- HIPAA note: "This form is not for medical emergencies"
- Colors: clean white/blue/green (clinical trust)

## Legal / Accounting / Professional Services
Sections: Hero → Practice Areas / Services → Attorney/CPA Bio → FAQ → Free Consultation form → Contact
- FAQ: expandable accordion (vanilla JS)
- Consultation form: Netlify Forms
- Colors: navy/charcoal/gold (authority)

## Gym / Fitness Studio
Sections: Hero → Class Schedule → Membership Plans → Trainers → Gallery → Sign Up
- Membership plans: pricing cards (Basic / Premium / Elite)
- Class schedule: simple HTML table
- Colors: bold (black/electric blue/orange)

## Contractor / Plumber / Electrician / HVAC
Sections: Hero ("Fast, Reliable, Local") → Services → Service Area Map → Photo Gallery → Get a Free Quote → Contact
- Quote form: service type, address, description, urgency
- Trust badges: Licensed, Insured, X Years Experience
- Colors: trade-appropriate (blue/yellow for electrician, orange/white for plumber)

## Bakery / Caterer
Sections: Hero → Featured Items / Menu → Story → Gallery → Order Form → Contact
- Gallery: full-width CSS grid of product photos (use placeholder gradients)
- Order form: Netlify Forms with date picker
- Colors: warm cream/pink/chocolate

## General / Default
Sections: Hero → About → Services (3-column grid) → Testimonials → Contact Form
- Safe for any business type that doesn't match above

## SEO meta tags to always include
```html
<title>[Business Name] | [City] [Category]</title>
<meta name="description" content="[Business Name] in [City] — [brief description]. Call [phone] or visit us at [address].">
<meta property="og:title" content="[Business Name]">
<meta property="og:description" content="[brief description]">
<meta property="og:type" content="website">
<link rel="canonical" href="https://[netlify-url]">
```

## AI chat widget (include on every site)
Use Tidio free embed (no API key needed for basic chat):
```html
<script src="//code.tidio.co/PLACEHOLDER_TIDIO_ID.js" async></script>
```
Note in the code: "Replace PLACEHOLDER_TIDIO_ID with client's Tidio public key after they sign up at tidio.com (free tier)"

## Netlify Forms (always include)
```html
<form name="contact" method="POST" netlify netlify-honeypot="bot-field">
  <input type="hidden" name="form-name" value="contact">
  <input type="hidden" name="bot-field">
  <!-- fields here -->
</form>
```
This works automatically on Netlify — no backend needed. Form submissions go to Netlify dashboard.
