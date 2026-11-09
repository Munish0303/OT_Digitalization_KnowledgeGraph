"""Captures the deck's app screenshots into deck/img/ (needs the stack running on :8501).

    pip install playwright   # uses the locally installed Chrome
    python deck/screenshots.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

IMG = Path(__file__).parent / "img"
URL = "http://localhost:8501"
PAD = 16

# file, tab index, viewport width, text of the first element to include, last element to include
SHOTS = [
    ("app_trace.png", 0, 1400, "Master Recipe", "[data-testid=stVegaLiteChart]"),
    ("app_fault.png", 1, 1300, "Per-batch aggregates", "[data-testid=stVegaLiteChart]"),
    ("app_maint.png", 2, 1400, "Device model", "[data-testid=stAlert]"),
]


def box(loc):
    loc.scroll_into_view_if_needed()
    return loc.bounding_box()


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    IMG.mkdir(exist_ok=True)
    for file, tab, width, first_text, last_sel in SHOTS:
        # A tall viewport so Streamlit's inner scroll container never has to scroll.
        page = browser.new_page(viewport={"width": width, "height": 2600}, device_scale_factor=2)
        page.goto(URL)
        page.wait_for_selector("button[role=tab]", timeout=60000)
        page.locator("button[role=tab]").nth(tab).click()
        panel = page.locator("[role=tabpanel]:visible")
        page.wait_for_timeout(5000)  # charts and dataframes render asynchronously
        top = box(panel.get_by_text(first_text, exact=False).first)
        bottom = box(panel.locator(last_sel).last)
        main = box(panel)
        clip = {"x": main["x"] - PAD, "y": top["y"] - PAD, "width": main["width"] + 2 * PAD,
                "height": bottom["y"] + bottom["height"] - top["y"] + 2 * PAD}
        page.screenshot(path=str(IMG / file), clip=clip)
        print(f"{file}: {clip['width']:.0f}x{clip['height']:.0f} (ratio {clip['width'] / clip['height']:.2f})")
        page.close()
    browser.close()
