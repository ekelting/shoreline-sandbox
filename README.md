# Shoreline Sandbox

An interactive, playful shoreline-change simulator for the general public. Place groins, T-groins (spurs), jetties, offshore breakwaters, seawalls, rivers and beach nourishment on a straight 1.5 km beach. Choose the wave direction, height, period and season, send a nor'easter or a tropical storm, raise the sea level, and watch the shoreline evolve. A live panel shows the governing equation, and new terms appear as you add each structure or process.

The beach is generic, oriented like Saco Bay, Maine (it faces east, with north on the left). A Saco Bay version is planned.

## Try it

**Live site:** https://ekelting.github.io/shoreline-sandbox/

You can also download this repository and open `index.html` in any modern browser. An internet connection is needed for the fonts and the equation renderer.

## How to use it

1. **Pick a place.** Start from the generic beach, or load a Maine beach (Camp Ellis, Camp Ellis with the new spur jetty, Old Orchard Beach, Pine Point, Wells Beach, Kennebunk Beach, Ogunquit Beach, Popham Beach). Each one loads that beach's main structures, which way it faces, and its wave and sand settings.
2. **Build.** Pick a tool (Groin, T-groin / spur, Jetty, Breakwater, Seawall, Add sand, River, Nesting area) and click the water or the beach. Drag to set a groin's length or a breakwater's or seawall's extent. Use **Remove** or **Undo last** to take things away.
3. **Set the waves.** Choose *Year-round* (waves change month by month) or hold one season, or drag the direction dial and the height and period sliders for custom waves.
4. **Run time.** Press **Start model**, and use the **Speed** slider to go from 1 year every 30 seconds up to 2 years per second. **Pause model** freezes the beach; the waves keep moving.
5. **Add weather.** Send a nor'easter or a tropical storm (the sim slows to about a day per second so you can watch), or raise the sea-level-rise slider.
6. **Read the results.** The chart shows how far the shoreline has moved at each point, the tiles count houses at risk and safe shorebird nesting areas (with chicks fledged each season), and **Look** mode shows beach width and sand drift wherever you hover.
7. **Read the math.** The panel on the right shows the equation being solved. Each structure or process you add puts a new, coloured term into it, with a plain-language explanation and live values.

Not sure where to start? Try the four ready-made experiments: a groin field, a river-mouth jetty, a breakwater salient and a seawall squeeze.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout, controls and text |
| `css/style.css` | Styles (light and dark themes) |
| `js/sandbox.js` | Model, rendering, tools and the equation panel |
| `js/mathjax-config.js` | Settings for MathJax 3.2.2, which draws the equations |

## The model

The shoreline position is split into a long-term alongshore part and a fast cross-shore (storm/season) part, $y = y_s + y_c$, solved with explicit finite differences on 150 cells of 10 m with an adaptive, stability-limited time step.

**Sand budget (one-line model; Pelnard-Considère 1956)**

$$\frac{\partial y_s}{\partial t} = -\frac{1}{D}\frac{\partial Q}{\partial x} + \frac{q(x,t)}{D} - \frac{W_*}{D}\frac{d\eta}{dt}, \qquad D = h_* + B$$

**Longshore transport (GENESIS form; Hanson 1989, Ozasa & Brampton 1980)**

$$Q = \left(H_b^2 C_g\right)_b\left[a_1 \sin 2(\theta_b-\phi) - a_2\cos(\theta_b-\phi)\frac{\partial H_b}{\partial x}\right], \qquad \phi = \arctan\frac{\partial y}{\partial x}$$

with $a_1 = K_1/[16(s-1)(1-p)1.416^{5/2}]$ and $a_2 = K_2/[8(s-1)(1-p)\tan\beta\,1.416^{7/2}]$, $K_2 = 0.8K_1$, $\tan\beta = 0.03$. The $\partial H_b/\partial x$ term is limited to $\pm a_1$ for numerical robustness.

**Breaking waves (Komar & Gaughan 1972) and refraction (Snell's law)**

$$H_b = 0.39\,g^{1/5}\left(T H_0^2\right)^{2/5}, \qquad \frac{\sin\theta_b}{C_b} = \frac{\sin\theta_0}{C_0}$$

**Groins and jetties (bypassing boundary condition)**

$$Q(x_g) = \mathrm{BYP}\,Q, \qquad \mathrm{BYP} = 1 - \frac{y_G}{y_B}, \qquad y_B = \left(\frac{h_b}{A}\right)^{3/2}$$

where $A = 0.21\,d_{50}^{0.48}$ is the Dean profile parameter. Groins also shelter their lee side from oblique waves (Bakker 1968; Bakker et al. 1970).

**Breakwaters:** $H_b \to K_d H_b$ in the geometric shadow, with smooth diffraction edges; a shoreline that reaches the breakwater forms a tombolo.

**Seawalls:** $y(x,t) \ge y_w$, enforced by limiting outgoing transport (so the beach in front can disappear).

**Storms and seasons (Miller & Dean 2004)**

$$\frac{\partial y_c}{\partial t} = k\,(y_{eq} - y_c), \qquad y_{eq} = -W\,\frac{0.068H_b + S}{B + 1.28H_b}$$

with $k = 150\ \mathrm{yr^{-1}}$ for erosion and $8\ \mathrm{yr^{-1}}$ for recovery, $W = 250$ m, and surge $S$ during storms.

**Sea-level rise (Bruun 1962):** retreat rate $= \dfrac{W_*}{h_*+B}\dfrac{d\eta}{dt}$, $W_* = (h_*/A)^{3/2}$.

**Wave climate:** illustrative monthly offshore values for the Gulf of Maine (winter swell from the E–ENE, calmer summer swell from the SSE), informed by the UNE Camp Ellis wave buoy and NOAA NDBC buoy 44007. Storms: nor'easter $H_0$ = 4.5 m, $T$ = 11 s, from ENE, surge 0.9 m, 3 days; tropical storm $H_0$ = 4 m, $T$ = 13 s, from SSE, surge 0.6 m, 2 days.

**Maine beach presets:** each place is a simplified 1.5 km stretch with its main structures at approximate sizes and positions. The monthly climate is rotated to the direction the beach faces, turned clockwise by a site-specific angle to stand in for bending by headlands and bays, and scaled by an exposure factor (e.g. 0.55 for sheltered Camp Ellis). These are teaching estimates, not calibrated values.

**Shorebird nesting:** piping plovers and least terns (endangered in Maine) nest on dry sand in front of the dunes from May 1 to August 31. A nesting area is safe with at least 20 m of dry beach in front of the dune, at risk below 20 m and lost below 8 m. A storm during the season washes out nests where the beach is narrower than 25 m + 30 × surge. Each season, safe areas fledge 1.44 chicks per pair (the 2025 Maine rate), and at-risk areas half that.

## Limitations

This is a teaching tool, not a forecast. Waves are uniform alongshore apart from structure effects, forcing uses monthly averages (so drift rates are high), and dunes, overwash, inlets, rip currents and seawall reflection are not modelled.

## References

- Bakker, W.T. (1968). The dynamics of a coast with a groyne system. *Proc. 11th Coastal Engineering Conf.*, ASCE.
- Bakker, W.T., Klein Breteler, E.H.J. & Roos, A. (1970). The dynamics of a coast with a groyne system. *Proc. 12th Coastal Engineering Conf.*, ch. 64.
- Bruun, P. (1962). Sea-level rise as a cause of shore erosion. *J. Waterways and Harbors Div.*, ASCE 88.
- Dean, R.G. (1991). Equilibrium beach profiles: characteristics and applications. *J. Coastal Research* 7(1).
- Hanson, H. (1989). GENESIS: a generalized shoreline change numerical model. *J. Coastal Research* 5(1).
- Komar, P.D. & Gaughan, M.K. (1972). Airy wave theory and breaker height prediction. *Proc. 13th Coastal Engineering Conf.*
- Le Méhauté, B. & Soldate, M. (1977). *Mathematical Modeling of Shoreline Evolution*. CERC Misc. Report 77-10.
- Miller, J.K. & Dean, R.G. (2004). A simple new shoreline change model. *Coastal Engineering* 51.
- Ozasa, H. & Brampton, A.H. (1980). Mathematical modelling of beaches backed by seawalls. *Coastal Engineering* 4.
- Pelnard-Considère, R. (1956). Essai de théorie de l'évolution des formes de rivage en plages de sable et de galets. *4èmes Journées de l'Hydraulique*.
- U.S. Army Corps of Engineers (1984). *Shore Protection Manual*; (2002) *Coastal Engineering Manual*, EM 1110-2-1100.
- NOAA NDBC station 44007: https://www.ndbc.noaa.gov/station_page.php?station=44007
- NOAA sea level trends, Portland ME 8418150: https://tidesandcurrents.noaa.gov/sltrends/sltrends_station.shtml?id=8418150
- UNE Camp Ellis wave buoy: https://ekelting.github.io/UNE-Camp-Ellis-SPOT-32787C/
- Maine Audubon (2025). Plovers all over: 2025 season recap: https://maineaudubon.org/news/plovers-all-over-2025-season-recap/
- Maine IF&W. Piping plover and least tern nesting sites, essential habitat: https://www.maine.gov/ifw/fish-wildlife/wildlife/endangered-threatened-species/essential-wildlife-habitat/pplt-nests.html
- Maine Geological Survey, Saco Bay coastal processes and beach erosion: https://www.maine.gov/dacf/mgs/explore/marine/virtual/saco/virtual_saco_bay.pdf
- USACE New England District, Camp Ellis Beach Shore Damage Mitigation Project: https://www.nae.usace.army.mil/Missions/Projects-Topics/Camp-Ellis/
- Portland Press Herald (2026). Saco's Camp Ellis jetty project is underway: https://www.pressherald.com/2026/07/09/sacos-camp-ellis-jetty-project-is-underway-heres-what-you-need-to-know/
- Webhannet River and Wells Harbor jetties: https://en.wikipedia.org/wiki/Webhannet_River
- Maine Geological Survey (2024). Shoreline dynamics at Popham Beach State Park: https://digitalmaine.com/cgi/viewcontent.cgi?article=1636&context=mgs_publications

## License

MIT, see `LICENSE`.
