// The imprint ("Impressum") as a normal app screen. English only.
import { icon } from '../../dom.js'

const MAIL = 'hitstudio@dittes.info'

export function imprintHTML() {
  return `<section class="imp-root">
  <header class="imp-head">
    <span class="imp-ic">${icon('info')}</span>
    <div><h1>Imprint</h1><p class="muted">Legal notice pursuant to § 5 German Digital Services Act (DDG)</p></div>
  </header>

  <div class="imp-grid">
    <article class="imp-card">
      <h2>Provider</h2>
      <address>HitStudio<br />c/o Andreas Dittes<br />Bautzener Str. 35<br />10829 Berlin<br />Germany</address>
    </article>
    <article class="imp-card">
      <h2>Contact</h2>
      <p>Email: <a href="mailto:${MAIL}">${MAIL}</a></p>
      <p class="muted">HitStudio is a non-commercial community project. No telephone number is offered; please get in touch by email.</p>
    </article>
    <article class="imp-card">
      <h2>Responsible for content</h2>
      <p>Responsible under § 18 (2) of the German Interstate Media Treaty (MStV):</p>
      <address>Andreas Dittes<br />Bautzener Str. 35<br />10829 Berlin, Germany</address>
    </article>
  </div>

  <article class="imp-card imp-wide">
    <h2>Privacy</h2>
    <p>HitStudio runs entirely in your browser. Projects, songs, recordings and settings are stored only on your device (browser storage). No audio is uploaded, there are no user accounts, no tracking and no advertising cookies.</p>
    <p>If you play a radio station from the library, your browser connects directly to that station's server, so the station receives your IP address as with any audio stream. When you load this site, the hosting provider processes technically necessary server log data (for example IP address, time and requested file).</p>
    <p>Under the GDPR you have the rights of access, rectification, erasure, restriction of processing, data portability and objection, and the right to lodge a complaint with a supervisory authority. In Berlin this is the Berliner Beauftragte für Datenschutz und Informationsfreiheit. Questions: <a href="mailto:${MAIL}">${MAIL}</a>.</p>
  </article>

  <article class="imp-card imp-wide">
    <h2>Liability for content and links</h2>
    <p>We are responsible for our own content under general law. Under §§ 8 to 10 DDG we are not obliged to monitor third-party information that is transmitted or stored, or to investigate circumstances that indicate unlawful activity. Obligations to remove or block information under general law remain unaffected. Liability is only possible from the moment we learn of a specific infringement, and we will remove such content promptly.</p>
    <p>HitStudio links to external websites and audio streams (such as radio stations). We do not control their content and accept no liability for it; the respective provider is always responsible. Radio streams are played directly from the station and are not recorded, stored or redistributed by HitStudio.</p>
    <p>Content you create or import in HitStudio stays on your device. You are responsible for it and for third-party rights in it, such as copyright in imported music.</p>
  </article>

  <div class="imp-grid imp-grid-2">
    <article class="imp-card">
      <h2>Copyright and licenses</h2>
      <p>Content created by the operators is subject to German copyright law. HitStudio uses the open-source libraries Three.js (MIT), Immer (MIT), lamejs (LGPL) and Lucide icons (ISC); their licenses ship with the source code. The demo songs and the opening sound are synthesized for this project.</p>
    </article>
    <article class="imp-card">
      <h2>Consumer dispute resolution</h2>
      <p>We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.</p>
    </article>
  </div>
</section>`
}
