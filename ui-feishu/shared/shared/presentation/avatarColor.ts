const palette: Record<string, string> = {
  researcher: "#5179db",
  manager: "#19a592",
  engineer: "#8370d9",
  risk: "#ca9950",
};

export const avatarColor = (id = "") => palette[id] || "#4b87b4";
