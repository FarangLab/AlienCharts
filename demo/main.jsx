import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import DemoPage from "../examples/DemoPage.jsx";
import logo from "../assets/aliencharts_logo_small.png";
import title from "../assets/aliencharts_title.svg";
import "../dist/aliencharts.css";
import "./styles.css";

const DemoButton = ({
  className = "",
  size: _size,
  variant: _variant,
  ...props
}) => (
  <button className={`demo-button ${className}`} type="button" {...props} />
);

const DemoInput = ({ className = "", ...props }) => (
  <input className={`demo-input ${className}`} {...props} />
);

const DemoSwitch = ({ checked, onCheckedChange }) => (
  <button
    aria-checked={checked}
    aria-label="Toggle live append"
    className="demo-switch"
    onClick={() => onCheckedChange(!checked)}
    role="switch"
    type="button"
  >
    <span />
  </button>
);

function DemoSite() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="demo-site">
      <header className="demo-site-header">
        <a
          aria-label="AlienCharts home"
          className="demo-brand"
          href="https://github.com/FarangLab/AlienCharts"
        >
          <img alt="" className="demo-logo" src={logo} />
          <img alt="AlienCharts" className="demo-title" src={title} />
        </a>
        <nav className="demo-site-links" aria-label="Demo links">
          <button
            className="demo-header-button"
            onClick={() => setDark((value) => !value)}
            type="button"
          >
            {dark ? "Light theme" : "Dark theme"}
          </button>
          <a href="https://github.com/FarangLab/AlienCharts">
            View on GitHub
          </a>
        </nav>
      </header>
      <main className="demo-site-main">
        <DemoPage
          Button={DemoButton}
          Input={DemoInput}
          Switch={DemoSwitch}
          initialChartCount={20}
          initialColumns={3}
          initialLiveAppend
          initialPointCount={500000}
          initialSeriesPerChart={2}
          showDatasetControls={false}
        />
      </main>
    </div>
  );
}

createRoot(document.querySelector("#app")).render(<DemoSite />);
