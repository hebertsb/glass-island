import { useEffect, useState } from "react";
import type { RobotMood } from "../types";

interface RobotFaceProps {
  mood: RobotMood;
  color?: string;
  size?: "xs" | "sm" | "md";
  showMouth?: boolean;
  onClick?: () => void;
  title?: string;
}

/**
 * Ojitos minimalistas con vida estilo Dynamic Island / TwoCode:
 * dos puntos luminosos sutiles que parpadean, miran curiosos hacia los lados y
 * se transforman en arcos felices (`◠ ◠`), guiño o enojo al interactuar.
 */
export default function RobotFace({
  mood,
  color = "#f8fafc",
  size = "sm",
  showMouth = false,
  onClick,
  title,
}: RobotFaceProps) {
  const [blinking, setBlinking] = useState(false);
  const [lookX, setLookX] = useState(0);
  const [lookY, setLookY] = useState(0);

  useEffect(() => {
    let alive = true;
    let t1: number;
    let t2: number;
    const schedule = () => {
      const wait = 2400 + Math.random() * 3400;
      t1 = window.setTimeout(() => {
        if (!alive) return;
        setBlinking(true);
        t2 = window.setTimeout(() => {
          if (!alive) return;
          setBlinking(false);
          if (Math.random() < 0.55) {
            setLookX(Math.random() > 0.5 ? 2.2 : -2.2);
            setLookY(Math.random() > 0.7 ? -0.8 : 0);
          } else {
            setLookX(0);
            setLookY(0);
          }
          schedule();
        }, 125);
      }, wait);
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const dims =
    size === "md"
      ? { w: 54, h: 24 }
      : size === "sm"
        ? { w: 46, h: 20 }
        : { w: 38, h: 17 };

  const eyeColor =
    mood === "angry"
      ? "#fb7185"
      : mood === "happy" || mood === "excited"
        ? "#6ee7b7"
        : mood === "music"
          ? "#fda4af"
          : color;

  const renderEye = (cx: number, isRight: boolean) => {
    if (mood === "wink" && isRight) {
      return (
        <path
          d={`M${cx - 5} 11 Q${cx} 5.5 ${cx + 5} 11`}
          fill="none"
          stroke={eyeColor}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      );
    }
    if (blinking && mood !== "angry") {
      return (
        <line
          x1={cx - 4.5}
          y1="10"
          x2={cx + 4.5}
          y2="10"
          stroke={eyeColor}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      );
    }
    if (mood === "happy" || mood === "excited") {
      return (
        <path
          d={`M${cx - 5.2} 11.5 Q${cx} 5 ${cx + 5.2} 11.5`}
          fill="none"
          stroke={eyeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      );
    }
    if (mood === "angry") {
      return (
        <g>
          <circle cx={cx} cy="11" r="3.6" fill={eyeColor} />
          <line
            x1={isRight ? cx + 5 : cx - 5}
            y1="6"
            x2={isRight ? cx - 4 : cx + 4}
            y2="9.5"
            stroke="#0c0f16"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </g>
      );
    }
    if (mood === "sleepy") {
      return (
        <path
          d={`M${cx - 4.5} 10 Q${cx} 13.5 ${cx + 4.5} 10`}
          fill="none"
          stroke={eyeColor}
          strokeWidth="2.1"
          strokeLinecap="round"
          opacity="0.7"
        />
      );
    }
    if (mood === "focus") {
      return (
        <rect
          x={cx - 4.8}
          y="7.8"
          width="9.6"
          height="4.6"
          rx="2.3"
          fill={eyeColor}
        />
      );
    }
    // Idle / Music: ojitos circulares suaves con halo sutil
    return (
      <g
        style={{
          transform: `translate(${lookX}px, ${lookY}px)`,
          transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <circle cx={cx} cy="10" r="4.6" fill={eyeColor} />
      </g>
    );
  };

  return (
    <span
      className={`robot-face robot-face--${mood}`}
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: onClick ? "pointer" : "default",
        filter: `drop-shadow(0 0 5px ${eyeColor}99)`,
      }}
    >
      <svg
        width={dims.w}
        height={showMouth ? dims.h + 5 : dims.h}
        viewBox={showMouth ? "0 0 56 26" : "0 0 56 20"}
        aria-hidden="true"
      >
        {renderEye(17, false)}
        {renderEye(39, true)}
        {showMouth && (
          <path
            d={
              mood === "happy" || mood === "excited"
                ? "M23 19 Q28 24 33 19"
                : mood === "angry"
                  ? "M23 22 Q28 18 33 22"
                  : "M24 20.5 L32 20.5"
            }
            fill="none"
            stroke={eyeColor}
            strokeWidth="1.9"
            strokeLinecap="round"
            opacity="0.85"
          />
        )}
      </svg>
    </span>
  );
}
