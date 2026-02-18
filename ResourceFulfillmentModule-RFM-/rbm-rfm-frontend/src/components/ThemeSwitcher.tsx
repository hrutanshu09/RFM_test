import React, { useState, useEffect } from "react";
import "../styles/ThemeSwitcher.css";

type Theme =
  | "default"
  | "dark-theme"
  | "ocean-theme"
  | "forest-theme"
  | "sunset-theme"
  | "purple-theme";

const ThemeSwitcher: React.FC = () => {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("app-theme") as Theme | null;
    return saved || "default";
  });

  useEffect(() => {
    // Remove previous theme
    document.documentElement.classList.forEach((cls) => {
      if (cls.endsWith("-theme")) {
        document.documentElement.classList.remove(cls);
      }
    });

    // Add new theme
    if (currentTheme !== "default") {
      document.documentElement.classList.add(currentTheme);
    }

    // Save to localStorage
    localStorage.setItem("app-theme", currentTheme);
  }, [currentTheme]);

  const themes: { value: Theme; label: string; emoji: string }[] = [
    { value: "default", label: "Purple", emoji: "🟣" },
    { value: "dark-theme", label: "Dark", emoji: "🌙" },
    { value: "ocean-theme", label: "Ocean", emoji: "🌊" },
    { value: "forest-theme", label: "Forest", emoji: "🌲" },
    { value: "sunset-theme", label: "Sunset", emoji: "🌅" },
    { value: "purple-theme", label: "Violet", emoji: "💜" },
  ];

  return (
    <div className="theme-switcher">
      <label htmlFor="theme-select">Theme:</label>
      <select
        id="theme-select"
        value={currentTheme}
        onChange={(e) => setCurrentTheme(e.target.value as Theme)}
        className="theme-select"
      >
        {themes.map((theme) => (
          <option key={theme.value} value={theme.value}>
            {theme.emoji} {theme.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ThemeSwitcher;
