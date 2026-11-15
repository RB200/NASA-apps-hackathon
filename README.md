# Lunar Analog Finder

Lunar Analog Finder compares nine Artemis candidate landing regions near the Moon’s south pole with terrain on Earth. The atlas ranks Earth sites by terrain similarity and adds reachability and shadow coverage when comparison data is available. The rover simulator lets you explore a matched pair at ground level.

NASA’s [2024 release](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/) used the Artemis III label under the plan at the time. NASA now plans [Artemis III](https://www.nasa.gov/mission/artemis-iii/) as a demonstration in low Earth orbit and [Artemis IV](https://www.nasa.gov/mission/artemis-iv/) as the first crewed lunar landing of the program.

## Start the app

Use Python 3.12 and a browser with WebGL support. The first launch installs the backend dependencies.

| Platform | Start | Stop |
| --- | --- | --- |
| macOS | Double-click [START.command](START.command), or run `./START.command` from the repository root. | Press Ctrl+C in the launcher terminal. |
| Windows | Make sure `python3 --version` works in a terminal, then double-click [START.bat](START.bat). | Close the backend, frontend, and rover server windows. |

The launcher starts all three servers and opens the atlas. The usual atlas address is [localhost:5173](http://localhost:5173/). If the macOS launcher chooses a different atlas port, use the address printed in the terminal. If startup fails, check the server output before reloading the browser.

## Use the atlas and rover

1. Click a marked lunar region on the south-pole map, or choose **Try the de Gerlache scenario**.
2. Open an Earth result to compare its terrain with the lunar site. If the backend is unavailable, the atlas labels its fallback results as sample data.
3. Select **Enter rover** to start driving at the matched Earth site. Each world opens at 06:00 local solar time by default. In terrain preview, use **Local solar time** to adjust the lighting before driving again.
4. Drive with **WASD** or the **arrow keys**. Use **Space** to brake, drag to orbit the camera, and scroll to zoom. Press **T** to switch worlds and **Esc** to exit drive mode.

## Repository layout

| Path | Contents |
| --- | --- |
| [frontend/](frontend/) | Atlas and browser assets |
| [backend/](backend/) | Matching and elevation API, data, and tests |
| [data_prep/](data_prep/) | Scripts for preparing atlas data |
| [lunar-rover-simulation/](lunar-rover-simulation/) | Rover viewer, terrain preparation, and tests |
| [source-assets/](source-assets/) | Original map image, rover model, and textures |

See the [backend notes](backend/README.md) for data formats and scoring, the [data preparation notes](data_prep/README.md) for dataset processing, and the [rover notes](lunar-rover-simulation/README.md) for terrain assets and traverse reports.

## Use of AI / Attribution

We used OpenAI Codex, Anthropic Claude, and GitHub Copilot as coding assistants. AI assistance covered implementation, debugging, and testing across the lunar atlas, terrain viewer, rover simulator, analog scoring, and data-processing scripts. Codex also helped draft and edit the project documentation.

GPT wrote the program that combined NASA images of the lunar south pole into the atlas background, a mosaic with more consistent lighting.

We adapted NASA’s Space Exploration Vehicle model so its wheels could rotate and move with the suspension during driving. Data and visual asset credits are listed in [SOURCES.md](SOURCES.md).
