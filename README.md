# Shoreline Sandbox 🏖️

An interactive, playful shoreline-change simulator for the general public. Place groins, T-groins, spurs, jetties, headlands, islands, offshore breakwaters, dune grass, seawalls, rivers and beach nourishment on a straight 1.5 km beach. Choose the wave direction, height, period and season, send a nor'easter or a tropical storm, time it with the tide, raise the sea level, and watch the shoreline and dunes evolve. A live panel shows the governing equation, and new terms appear as you add each structure or process.

The beach is generic, oriented like Saco Bay, Maine (it faces east, with north on the left). A Saco Bay version is planned.

## Try it

**Live site:** https://ekelting.github.io/shoreline-sandbox/

You can also download this repository and open `index.html` in any modern browser. An internet connection is needed for the fonts and the equation renderer.

## How to use it

New visitors start in **🙂 Simple** mode, which shows the main tools only, with a three-step checklist (pick a beach, press Start, send a storm) and a **Show me around** tour. The checklist hides once closed or finished; the **New here? Take a Tour** button at the top right brings it back and restarts the tour. Switch to **🔬 Explorer** at the top right for every tool, the wave and tide settings, the advanced settings and the math. The **🏆 Challenges** box offers goals to try: grow a tombolo, save Camp Ellis, help plovers fledge 160 chicks, and weather six storms on an eroded beach.

1. **Pick a place.** Start from the generic beach, or load a Maine beach from the Maine beaches box at the top right (Camp Ellis, Camp Ellis with the new spur jetty, Old Orchard Beach, Pine Point, Wells Beach, Kennebunk Beach, Ogunquit Beach, Popham Beach). Each one loads that beach's main structures, which way it faces, and its wave and sand settings.
2. **Build.** Pick a tool from the Build box above the beach (Groin, T-groin, Spur, Jetty, Island, Breakwater, Headland, Dune grass, Seawall, Add sand, River, Nesting area, Rebuild house) and click the water or the beach. A **Spur** is a groin with an arm off one side only: drag left or right to choose the side and length of the arm. Drag to set a groin's length or a breakwater's or seawall's extent. Use **Remove**, or **Undo** and **Remove all** at the end of the Basics row, to take things away. **Add sand** on the beach for a beach fill, or in the water to dump sand offshore and watch the waves push it toward shore (sand dumped deeper than the closure depth never moves). **Island** places a small island (drag sideways to make it bigger). Set the size of sand fills, and the width and sand supply of rivers, with the sliders under the tools (the river sliders also change the river you placed last). Click the upper beach with **Nesting area** for a standard roped-off area, or drag to choose its size: sideways for its length and toward the sea for its depth. Each plover pair needs about 32 m of beach, so a longer area can hold more pairs (up to 12). Plant **Dune grass** by dragging out a rectangle of whatever length and width you like (a click plants a 120 m strip); it thickens and spreads over the years. Houses that wash away leave empty lots; rebuild them one at a time with **Rebuild house** once there is at least 20 m of beach again.
3. **Set the waves.** Choose *Year-round* (waves change month by month) or hold one season, or drag the direction dial and the height and period sliders for custom waves.
The page sizes the beach view to your screen so the controls, the beach and the shoreline chart fit together; on shorter screens the view is squeezed top-to-bottom (distances across the beach are drawn shorter than distances along it).

4. **Run time.** Press **Start model** (green) and **Pause model** (red), side by side. **Fast-forward** steps the speed up from 1 year every 30 seconds to 2 years per second (one more press goes back to the slowest). Once the model has run, hold **Rewind** to go back through what happened (it keeps a snapshot about twice a month, and every couple of hours during storms); after rewinding, hold Fast-forward to replay forward, or press Start to carry on from that moment (the old future is replaced). Rewind is off during challenges. **Reset beach and clock** starts over. Holding a season (Winter, Spring, Summer, Fall) keeps that season's waves all year while the calendar keeps running, so plovers still nest in summer.
5. **Add weather.** Send a nor'easter or a tropical storm (the sim slows to 12 hours per second so you can watch the tide rise and fall). Choose whether the storm peaks at high tide, low tide or a random time, and set the tide height. Watch waves run up the beach, cut the dune back and, once the dune is gone, wash over onto the road and flood houses. You can also raise the sea-level-rise slider.
6. **Read the results.** The chart shows how far the shoreline has moved at each point, the tiles show the dry beach left at high tide, houses at risk, houses flooded by overwash, and safe shorebird nesting areas (with chicks fledged each season), and **Look** mode tells you what is under the pointer: water depth and waves, beach width and sand drift, or details of a structure, river or nesting area.
7. **Get feedback.** Pop-up messages announce storms, overwash, houses at risk, flooded or washed away, nests washed over or lost, and tombolos, and the ☀️ / 🌙 / 🖥️ buttons at the top switch between light, dark and automatic themes.
8. **Read the math.** The "math behind your beach" section shows the equation being solved right now, a list of its parts, the parts that are always on, and the parts you have added (with the ones you haven't unlocked yet shown faded). Each part has a plain-language explanation and live values.

Not sure where to start? Try the four ready-made experiments: a groin field, a river-mouth jetty, a breakwater salient and a seawall squeeze.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout, controls and text |
| `css/style.css` | Styles (light and dark themes) |
| `js/sandbox.js` | Model, rendering, tools and the equation panel |
| `js/mathjax-config.js` | Settings for MathJax 3.2.2, which draws the equations |

## The model

The beach is described by two lines (Bakker 1968; Hanson & Larson 2000): the shoreline $y_1$ and an offshore depth contour $y_2$ at depth $h_1 = \min(2.5\,\mathrm{m},\,0.4h_*)$. Both are solved with explicit finite differences on 150 cells of 10 m with an adaptive, stability-limited time step.

**Sand budget (two-line model)**

$$\frac{\partial y_1}{\partial t} = -\frac{1}{D_1}\frac{\partial Q_1}{\partial x} + \frac{q_y}{D_1} + \frac{q(x,t)}{D_1} - \frac{W_*}{D}\frac{d\eta}{dt}, \qquad \frac{\partial y_2}{\partial t} = -\frac{1}{D_2}\frac{\partial Q_2}{\partial x} - \frac{q_y}{D_2} - \frac{W_*}{D}\frac{d\eta}{dt}$$

with $D_1 = B + h_1$, $D_2 = h_* - h_1$ and $D = h_* + B$. Rivers, nourishment and eroded dune sand ($q$) go to line 1.

**Longshore transport (GENESIS form; Hanson 1989, Ozasa & Brampton 1980), shared between the lines**

$$Q_i = f_i\left(H_b^2 C_g\right)_b\left[a_1 \sin 2(\theta_b-\phi_i) - a_2\cos(\theta_b-\phi_i)\frac{\partial H_b}{\partial x}\right], \qquad f_1 = \min\!\left(1, \frac{y_2 - y_1}{y_B}\right),\ f_2 = 1 - f_1$$

where $\phi_i = \arctan(\partial y_i/\partial x)$, $a_1 = K_1/[16(s-1)(1-p)1.416^{5/2}]$ and $a_2 = K_2/[8(s-1)(1-p)\tan\beta\,1.416^{7/2}]$, $K_2 = 0.8K_1$, $\tan\beta = 0.03$. The $\partial H_b/\partial x$ term is limited to $\pm a_1$ for numerical robustness.

**Cross-shore exchange between the lines (storms and seasons)**

$$q_y = K\,(y_2 - y_1 - W_{eq}), \qquad W_{eq} = W_0 + W'\,\frac{0.068H_b + S + \eta_T}{B + 1.28H_b}$$

$W_0 = (h_1/A)^{3/2}$ is the calm Dean-profile distance, and $W' = 250\,(D_1 + D_2)/D_2$ m, so the shoreline's storm response matches Miller & Dean (2004). The distance relaxes at $150\ \mathrm{yr^{-1}}$ when storms pull sand offshore and $8\ \mathrm{yr^{-1}}$ when it returns; sand volume is conserved.

**Waves: breaking, refraction and diffraction**

$$H_b = 0.39\,g^{1/5}\left(T H_0^2\right)^{2/5} \ \text{(Komar \& Gaughan 1972)}, \qquad \left|\nabla\psi\right| = k(x,y),\quad \omega^2 = gk\tanh kh$$

The wave phase $\psi$ is solved on a 5 m grid by fast sweeping (Zhao 2005), with $k$ from the Fenton & McKee (1990) approximation of the dispersion relation. The depth comes from the two lines: a Dean profile scaled to reach $h_1$ at line 2, then $h = A\,(d - w + W_0)^{2/3}$ beyond it, using lines smoothed over about 20 m. Waves enter at the offshore edge and the upwave side with the straight-contour (Snell) solution; land and structures are solid, so crests bend toward the shore (refraction) and wrap around structure ends (diffraction, in the ray/eikonal sense). Crests are drawn as the contours $\psi = 2\pi n + \omega t$. The breaking angle $\theta_b$ used in the transport is the direction of $\nabla\psi$ at the breaker line of each cell (smoothed, and kept within ±46° of the Snell value). Wave heights in shadows use the sheltering factor $K_d$ below.

**Groins and jetties (bypassing, per line)**

$$Q_i(x_g) = \mathrm{BYP}_i\,Q_i, \qquad \mathrm{BYP}_1 = 1 - \frac{\min(y_G, w)}{w}, \qquad \mathrm{BYP}_2 = 1 - \frac{(y_G - w)_+}{y_B - w}, \qquad y_B = \left(\frac{h_b}{A}\right)^{3/2}$$

where $y_G$ is how far the groin extends past the shoreline, $w = \min(y_2 - y_1, y_B)$, and $A = 0.21\,d_{50}^{0.48}$ is the Dean profile parameter. A short groin blocks only line 1; a long one blocks both. Groins also shelter their lee side from oblique waves (Bakker 1968; Bakker et al. 1970).

**T-groins and spurs:** the shore-parallel head (both sides for a T-groin, one side for a spur) shelters the beach like a short breakwater and blocks the wave field.

**Breakwaters and islands:** $H_b \to K_d H_b$ in the geometric shadow, with smooth diffraction edges, and both are solid obstacles in the wave field; a shoreline that reaches one forms a tombolo. Islands are ellipses; the Popham Beach preset uses one for Fox Island.

**Offshore (nearshore) nourishment:** sand dumped in the water forms a Gaussian mound (130 m × 55 m spread, thickness capped at 75% of the depth) that makes the water shallower, so waves refract over it. Waves push it shoreward at $u \approx 150\,H_b\,(1 - h/h_*)$ m/yr (storms push it back out a little) and drift carries it alongshore; once it reaches line 2 it merges into the nearshore profile at 3 per year, and the cross-shore exchange then carries it up onto the beach. A mound below the closure depth ($h \ge h_*$) never moves. Sand dumped inside line 2 joins it immediately.

**Rivers:** a river delivers its sand supply $Q_r$ (set with the slider) to the beach on both sides of its mouth, and keeps its mouth open (the shoreline across the channel can build out at most 20 m). A river mouth held between jetties sends its sand out past the jetties instead, so it never reaches the beach.

**Dune grass:** on planted stretches the cross-shore rates become $K_v = (1-\beta)K$ during storm erosion and $(1+\gamma)K$ during recovery, with illustrative $\beta = 0.4$ and $\gamma = 0.3$; dune erosion is ×0.6 and dune regrowth ×1.5. Grass is planted as a rectangle you drag out. New plantings are sparse and fill in over a few years (cover $= 0.3 + 0.7(1 - e^{-t/2\,\mathrm{yr}})$). The patch spreads 2 m/yr along the beach (until it meets a structure, river or seawall) and up the dune, and 1.5 m/yr toward the water while it stays about 30 m back from the shoreline (up to 25 m past the dune toe); storms kill its front if the sea comes closer. Under the grass, trapped sand builds a new foredune at 1.5 m/yr where the dry beach is wider than 35 m. Plovers nest in sparse young grass and along its edge, so only dense, established grass (cover above 60%) pushes nesting areas seaward, to 8 m inside its front edge. Grass has no effect on longshore drift and stops working where the shoreline reaches the dune.

**Headlands and wave focusing:** a rocky headland blocks all drift ($\mathrm{BYP} = 0$) and leaves a strong wave shadow in its lee. Waves reflected off headlands and long jetties raise the waves on the beach just updrift: $H_b \to K H_b$ with $K = (1 - 0.8 S_h)(1 + 0.25e^{-d/70\,\mathrm{m}})$ within 220 m.

**Tides and storm timing:** during storms the tide is resolved, $\eta_T = A\cos[2\pi(t - t_{HW})/12.42\,\mathrm{h}]$, with $A$ = 1.3 m by default (Maine's range is about 2.6 m). The storm surge peaks sharply (about half a day), so whether it arrives at high or low tide matters. The storm can be set to peak at high tide, low tide or a random time.

**Dunes and overwash:** the total water level is $TWL = \eta + \eta_T + S + R_2$, with the 2% run-up of Stockdon et al. (2006), $R_2 \approx 1.1\sqrt{H_0L_0}\,(0.35\beta_f + \tfrac12\sqrt{0.563\beta_f^2 + 0.004})$, $\beta_f = 0.08$. When $TWL$ exceeds the dune toe, the dune face retreats (Larson et al. 2004):

$$\frac{dx_d}{dt} = \frac{4C_s\,(TWL - z_t)_+^2}{T\,(z_c - z_t)}$$

with $C_s = 9.3\times10^{-4}$, $z_c - z_t = 4.8$ m (fit to Camp Ellis). The toe height rises with dry-beach width, $z_t = \beta_f\,w$ (1.5–6 m), so wide beaches shield their dunes. Eroded dune sand feeds the beach; between storms, wind rebuilds the dune at 0.41 m/yr where the beach is wider than 20 m. When the 28 m dune is gone and $TWL$ is more than 0.8 m above the toe, waves wash over onto the road; a house within 30 m is counted as flooded (once per storm). Dune grass slows dune erosion ×0.6 and speeds regrowth ×1.5.

**Numerical safeguards:** line models are only valid for gently curving shorelines. When the angle between the breaking waves and the shoreline exceeds 45° the transport equation becomes anti-diffusive, which cut narrow canyons and spikes into tombolos. The relative angle in $Q_i$ is therefore capped at ±45°, sand that would push a line past a breakwater or island is shifted to the neighbouring cells (volume conserved), and a plan-shape limiter lets any stretch steeper than 35° from the trend slump sideways (volume conserved; not across groins, jetties, headlands or river mouths).

**Seawalls:** $y_1 \ge y_w$, enforced by limiting outgoing transport on line 1 (so the beach in front can disappear).

**Sea-level rise (Bruun 1962):** both lines retreat at $= \dfrac{W_*}{h_*+B}\dfrac{d\eta}{dt}$, $W_* = (h_*/A)^{3/2}$.

**Wave climate:** illustrative monthly offshore values for the Gulf of Maine (winter swell from the E–ENE, calmer summer swell from the SSE), informed by the UNE Camp Ellis wave buoy and NOAA NDBC buoy 44007. Storms: nor'easter $H_0$ = 4.5 m, $T$ = 11 s, from ENE, surge 0.9 m, 3 days; tropical storm $H_0$ = 4 m, $T$ = 13 s, from SSE, surge 0.6 m, 2 days.

**Maine beach presets:** each place is a simplified 1.5 km stretch with its main structures at approximate sizes and positions. The monthly climate is rotated to the direction the beach faces, turned clockwise by a site-specific angle to stand in for bending by headlands and bays, and scaled by an exposure factor (e.g. 0.55 for sheltered Camp Ellis). Beach orientations come from the shoreline trend on the map; the wave turning is set so the net drift goes the documented way (north in Saco Bay, about 15,000 m³/yr at Camp Ellis to match the UNE two-line model; north along Wells Beach toward the harbour jetties, inferred from the MGS widths below; south at Ogunquit; west at Popham), with the mean wave direction at Camp Ellis matching the UNE buoy (81°). Jetty lengths and spacings follow USACE and MGS figures where available (Camp Ellis north jetty 6,600 ft, cut off at the map edge; Scarborough River jetty 800 ft; Wells jetties 425 ft apart; Kennebunk west jetty 590 ft), and river sand supplies use published estimates where they exist (Saco River 13,000–22,000 yd³/yr). Each preset starts from the mean high-tide dry beach width measured along that beach by the Maine Geological Survey's beach mapping (2017–2025; MGS_Beach_Mapping feature service, layer 3): for example 0–3 m along the Camp Ellis jetty end rising to about 22 m toward Ferry Beach, 28–35 m at Old Orchard, 19–27 m at Pine Point, 45–55 m beside the Wells jetties, 4–27 m at Gooch's, 33–40 m at Ogunquit and 26–85 m at Popham. The starting shoreline is that width plus the beach uncovered between high and mid tide ($a_{tide}/\beta_f$ = 16 m), and the shoreline-change chart and tiles measure change from it. River mouths held between jetties fill the gap between them, and none of the preset river mouths has a bridge (only Ogunquit's, where Beach Street crosses the river): the road simply ends at the water, with no salt-marsh bank where the mouth is built up. These are still teaching estimates, not calibrated values. River sand supplies other than the Saco's (Kennebec 60,000, Scarborough 5,000, Kennebunk 5,000, Ogunquit 8,000, Webhannet 2,000 m³/yr) are rough guesses; the sim does not model river water discharge at all, only the sand a river delivers.

**Shorebird nesting:** piping plovers and least terns (endangered in Maine) nest on dry sand in front of the dunes from May 1 to August 31. A nesting area is safe with at least 20 m of dry beach in front of the dune, at risk below 20 m and lost below 8 m. A storm during the season washes out nests where the beach is narrower than 25 m + 30 × surge. Each season, safe areas fledge $p$ chicks per pair, and at-risk areas half that: $p$ = 1.44 (Maine statewide, 2025) except Camp Ellis and Pine Point ($p$ = 3/13 ≈ 0.23, the Camp Ellis–Pine Point stretch in 2025) and Wells ($p$ = 45/23 ≈ 1.96). About 1.25 chicks per pair just replaces adult deaths (Atlantic Coast estimates; the recovery goal is 1.5). Each spring a successful area gains a pair with probability $0.1 + 0.4(p - 1.25)$ (0–35%, up to 4 pairs) or, when $p < 1.25$, loses one with probability $0.4(1.25 - p)$; a failed area may lose a pair; and if any chicks fledged, a new pair may settle on a wide, open stretch with probability $(0.15 + 0.05\,n_{good})\,p/1.44$ (up to 8 areas). For comparison, Maine grew from 98 pairs in 2020 to 174 in 2025. The birds are drawn as adults on eggs in May, with chicks in June and July (more hatch than fledge) and adults alone in August.

## Limitations

This is a teaching tool, not a forecast. The wave field is geometric (ray) optics over an idealized sea bed, with a simpler sheltering factor for wave heights in shadows; forcing uses monthly averages (so drift rates are high), dunes and overwash are simplified to one value per 10 m, and inlets, rip currents and seawall reflection are not modelled.

## References

- Bakker, W.T. (1968). The dynamics of a coast with a groyne system. *Proc. 11th Coastal Engineering Conf.*, ASCE.
- Bakker, W.T., Klein Breteler, E.H.J. & Roos, A. (1970). The dynamics of a coast with a groyne system. *Proc. 12th Coastal Engineering Conf.*, ch. 64.
- Bruun, P. (1962). Sea-level rise as a cause of shore erosion. *J. Waterways and Harbors Div.*, ASCE 88.
- Dean, R.G. (1991). Equilibrium beach profiles: characteristics and applications. *J. Coastal Research* 7(1).
- Hanson, H. (1989). GENESIS: a generalized shoreline change numerical model. *J. Coastal Research* 5(1).
- Komar, P.D. & Gaughan, M.K. (1972). Airy wave theory and breaker height prediction. *Proc. 13th Coastal Engineering Conf.*
- Le Méhauté, B. & Soldate, M. (1977). *Mathematical Modeling of Shoreline Evolution*. CERC Misc. Report 77-10.
- Miller, J.K. & Dean, R.G. (2004). A simple new shoreline change model. *Coastal Engineering* 51.
- Larson, M., Erikson, L. & Hanson, H. (2004). An analytical model to predict dune erosion due to wave impact. *Coastal Engineering* 51.
- Fenton, J.D. & McKee, W.D. (1990). On calculating the lengths of water waves. *Coastal Engineering* 14.
- Hanson, H. & Larson, M. (2000). Simulating coastal evolution using a new type of N-line model. *Proc. 27th Coastal Engineering Conf.*
- Ozasa, H. & Brampton, A.H. (1980). Mathematical modelling of beaches backed by seawalls. *Coastal Engineering* 4.
- Pelnard-Considère, R. (1956). Essai de théorie de l'évolution des formes de rivage en plages de sable et de galets. *4èmes Journées de l'Hydraulique*.
- Stockdon, H.F., Holman, R.A., Howd, P.A. & Sallenger, A.H. (2006). Empirical parameterization of setup, swash, and runup. *Coastal Engineering* 53.
- U.S. Army Corps of Engineers (1984). *Shore Protection Manual*; (2002) *Coastal Engineering Manual*, EM 1110-2-1100.
- Zhao, H. (2005). A fast sweeping method for eikonal equations. *Mathematics of Computation* 74.
- NOAA NDBC station 44007: https://www.ndbc.noaa.gov/station_page.php?station=44007
- NOAA sea level trends, Portland ME 8418150: https://tidesandcurrents.noaa.gov/sltrends/sltrends_station.shtml?id=8418150
- UNE Camp Ellis wave buoy: https://ekelting.github.io/UNE-Camp-Ellis-SPOT-32787C/
- Maine Audubon (2025). Plovers all over: 2025 season recap: https://maineaudubon.org/news/plovers-all-over-2025-season-recap/
- Maine IF&W. Piping plover and least tern nesting sites, essential habitat: https://www.maine.gov/ifw/fish-wildlife/wildlife/endangered-threatened-species/essential-wildlife-habitat/pplt-nests.html
- Maine Geological Survey, Saco Bay coastal processes and beach erosion: https://www.maine.gov/dacf/mgs/explore/marine/virtual/saco/virtual_saco_bay.pdf
- USACE New England District, Camp Ellis Beach Shore Damage Mitigation Project: https://www.nae.usace.army.mil/Missions/Projects-Topics/Camp-Ellis/
- Portland Press Herald (2026). Saco's Camp Ellis jetty project is underway: https://www.pressherald.com/2026/07/09/sacos-camp-ellis-jetty-project-is-underway-heres-what-you-need-to-know/
- Webhannet River and Wells Harbor jetties: https://en.wikipedia.org/wiki/Webhannet_River
- Maine Geological Survey. Maine Beach Mapping (dry beach width and beach change rates, 2017–2025): https://experience.arcgis.com/experience/f93ea27787ea4944944eaa9d0c825597 (data: https://services1.arcgis.com/RbMX0mRVOFNTdLzd/ArcGIS/rest/services/MGS_Beach_Mapping/FeatureServer)
- U.S. Fish and Wildlife Service (2022). Abundance and productivity estimates, 2021 update: Atlantic Coast piping plover population: https://www.fws.gov/sites/default/files/documents/piping-plover-abundance-and-productivity-update-2021.pdf
- Maine Geological Survey (2024). Shoreline dynamics at Popham Beach State Park: https://digitalmaine.com/cgi/viewcontent.cgi?article=1636&context=mgs_publications

## License

MIT, see `LICENSE`.
