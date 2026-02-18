/* generator.js — moved from index.html */

let classes = {};

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function pascalCase(s) {
  return (
    (s || "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") || "AutoGen"
  );
}
function camel(str) {
  if (!str) return str;
  // remove leading underscores and convert snake/kebab/camel to lowerCamelCase
  str = str.replace(/^_+/, "");
  return str
    .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (m) => m.toLowerCase());
}

function isIsoDateString(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(s)
  );
}

function mergeTypes(a, b) {
  if (a === b) return a;
  const numset = new Set([a, b]);
  if (numset.has("int") && numset.has("double")) return "double";
  return "dynamic";
}

function deduceArrayType(key, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "List<dynamic>";
  let candidate = null;
  for (let i = 0; i < arr.length; i++) {
    const t = dartType(key, arr[i]);
    if (candidate === null) candidate = t;
    else candidate = candidate === t ? candidate : mergeTypes(candidate, t);
    if (candidate === "dynamic") break;
  }
  return "List<" + (candidate || "dynamic") + ">";
}

function dartType(key, val) {
  if (val === null) return "dynamic";
  if (typeof val === "number") return Number.isInteger(val) ? "int" : "double";
  if (typeof val === "boolean") return "bool";
  if (typeof val === "string") {
    if (isIsoDateString(val)) return "DateTime";
    return "String";
  }
  if (Array.isArray(val)) {
    return deduceArrayType(key, val);
  }
  if (typeof val === "object") {
    // empty object -> Map
    if (Object.keys(val).length === 0) return "Map<String,dynamic>";
    let cname = pascalCase(key);
    parseObject(cname, val);
    return cname;
  }
  return "dynamic";
}

function parseObject(className, obj) {
  // merge schemas for objects with the same className
  if (!classes[className]) classes[className] = [];
  // index existing fields by dart field name for merging aliases
  let fieldsByName = {};
  classes[className].forEach(
    (f) =>
      (fieldsByName[f.name] = Object.assign({}, f, {
        aliases: f.aliases ? f.aliases.slice() : [],
      })),
  );

  for (let k in obj) {
    const fieldName = camel(k);
    const newType = dartType(fieldName, obj[k]);

    if (fieldsByName[fieldName]) {
      // same dart name seen before -> add alias and merge types
      const existing = fieldsByName[fieldName];
      existing.aliases = existing.aliases || [];
      if (existing.key !== k && !existing.aliases.includes(k))
        existing.aliases.push(k);
      existing.type = mergeTypes(existing.type, newType);
    } else {
      // new field
      fieldsByName[fieldName] = {
        key: k,
        name: fieldName,
        type: newType,
        aliases: [],
      };
    }
  }

  // convert back to array preserving order of first-seen keys
  classes[className] = Object.keys(fieldsByName).map((n) => fieldsByName[n]);
}

function buildClass(name, fields) {
  let out = `class ${name} {\n`;
  fields.forEach((f) => (out += `  final ${f.type}? ${f.name};\n`));
  out += `\n  ${name}({\n`;
  fields.forEach((f) => (out += `    this.${f.name},\n`));
  out += `  });\n\n`;

  out += `  factory ${name}.fromJson(Map<String,dynamic> json){\n    return ${name}(\n`;
  fields.forEach((f) => {
    // determine JSON source expression (handles aliases like '_id' and 'id')
    const source =
      f.aliases && f.aliases.length
        ? f.aliases.map((a) => `json['${a}']`).join(" ?? ") +
          ` ?? json['${f.key}']`
        : `json['${f.key}']`;

    // DateTime
    if (f.type === "DateTime") {
      out += `      ${f.name}: (${source})!=null ? DateTime.parse((${source}).toString()) : null,\n`;
      return;
    }

    // If field has aliases, use json['alias'] ?? json['key']
    if (f.aliases && f.aliases.length) {
      const expr =
        f.aliases.map((a) => `json['${a}']`).join(" ?? ") +
        ` ?? json['${f.key}']`;
      if (f.type.startsWith("List<")) {
        const inner = f.type.replace("List<", "").replace(">", "");
        if (
          ["String", "int", "double", "bool", "dynamic", "DateTime"].includes(
            inner,
          )
        ) {
          if (inner === "DateTime") {
            out += `      ${f.name}: (${expr})!=null ? List.from(${expr}).map((e)=> e!=null ? DateTime.parse(e.toString()) : null).toList() : null,\n`;
          } else if (inner === "double") {
            out += `      ${f.name}: (${expr})!=null ? List.from(${expr}).map((e)=> (e as num?)?.toDouble()).toList() : null,\n`;
          } else if (inner === "int") {
            out += `      ${f.name}: (${expr})!=null ? List.from(${expr}).map((e)=> (e as num?)?.toInt()).toList() : null,\n`;
          } else {
            out += `      ${f.name}: (${expr})!=null ? List<${inner}>.from(${expr}) : null,\n`;
          }
        } else {
          out += `      ${f.name}: (${expr})!=null ? List.from(${expr}).map((e)=>${inner}.fromJson(e)).toList() : null,\n`;
        }
      } else if (classes[f.type]) {
        out += `      ${f.name}: (${expr})!=null ? ${f.type}.fromJson(${expr}) : null,\n`;
      } else if (f.type === "double") {
        out += `      ${f.name}: ((${expr}) as num?)?.toDouble(),\n`;
      } else if (f.type === "int") {
        out += `      ${f.name}: ((${expr}) as num?)?.toInt(),\n`;
      } else {
        out += `      ${f.name}: ${expr},\n`;
      }
      return;
    }

    // Map
    if (f.type === "Map<String,dynamic>") {
      out += `      ${f.name}: json['${f.key}']!=null ? Map<String,dynamic>.from(json['${f.key}']) : null,\n`;
      return;
    }

    if (f.type.startsWith("List<")) {
      let inner = f.type.replace("List<", "").replace(">", "");
      if (
        ["String", "int", "double", "bool", "dynamic", "DateTime"].includes(
          inner,
        )
      ) {
        if (inner === "DateTime") {
          out += `      ${f.name}: json['${f.key}']!=null ? List.from(json['${f.key}']).map((e)=> e!=null ? DateTime.parse(e.toString()) : null).toList() : null,\n`;
        } else if (inner === "double") {
          out += `      ${f.name}: json['${f.key}']!=null ? List.from(json['${f.key}']).map((e)=> (e as num?)?.toDouble()).toList() : null,\n`;
        } else if (inner === "int") {
          out += `      ${f.name}: json['${f.key}']!=null ? List.from(json['${f.key}']).map((e)=> (e as num?)?.toInt()).toList() : null,\n`;
        } else {
          out += `      ${f.name}: json['${f.key}']!=null ? List<${inner}>.from(json['${f.key}']) : null,\n`;
        }
      } else {
        out += `      ${f.name}: json['${f.key}']!=null ? List.from(json['${f.key}']).map((e)=>${inner}.fromJson(e)).toList() : null,\n`;
      }
    } else if (classes[f.type]) {
      out += `      ${f.name}: json['${f.key}']!=null ? ${f.type}.fromJson(json['${f.key}']) : null,\n`;
    } else if (f.type === "double") {
      out += `      ${f.name}: (json['${f.key}'] as num?)?.toDouble(),\n`;
    } else if (f.type === "int") {
      out += `      ${f.name}: (json['${f.key}'] as num?)?.toInt(),\n`;
    } else {
      out += `      ${f.name}: json['${f.key}'],\n`;
    }
  });
  out += `    );\n  }\n\n`;

  out += `  Map<String,dynamic> toJson(){\n    return {\n`;
  fields.forEach((f) => {
    if (f.type === "DateTime") {
      out += `      '${f.key}': ${f.name}?.toIso8601String(),\n`;
      return;
    }

    if (f.type === "Map<String,dynamic>") {
      out += `      '${f.key}': ${f.name},\n`;
      return;
    }

    if (f.type.startsWith("List<")) {
      let inner = f.type.replace("List<", "").replace(">", "");
      if (
        ["String", "int", "double", "bool", "dynamic", "DateTime"].includes(
          inner,
        )
      ) {
        if (inner === "DateTime") {
          out += `      '${f.key}': ${f.name}?.map((e)=>e?.toIso8601String()).toList(),\n`;
        } else {
          out += `      '${f.key}': ${f.name},\n`;
        }
      } else {
        out += `      '${f.key}': ${f.name}?.map((e)=>e.toJson()).toList(),\n`;
      }
    } else if (classes[f.type]) {
      out += `      '${f.key}': ${f.name}?.toJson(),\n`;
    } else {
      out += `      '${f.key}': ${f.name},\n`;
    }
    // if field had aliases like '_id' and 'id', also include alternate key in toJson
    if (f.aliases && f.aliases.length) {
      f.aliases.forEach((a) => (out += `      '${a}': ${f.name},\n`));
    }
  });
  out += `    };\n  }\n\n`;

  out += `  ${name} copyWith({\n`;
  fields.forEach((f) => (out += `    ${f.type}? ${f.name},\n`));
  out += `  }){\n    return ${name}(\n`;
  fields.forEach(
    (f) => (out += `      ${f.name}: ${f.name} ?? this.${f.name},\n`),
  );
  out += `    );\n  }\n}\n\n`;
  return out;
}

// ---------- Freezed generator ----------
function buildFreezedClass(name, fields) {
  let out = `@freezed\nclass ${name} with _\$${name} {\n`;
  out += `  const factory ${name}({\n`;
  fields.forEach((f) => {
    // if json key differs from dart name or aliases exist, add JsonKey(name: '...')
    const needsJsonKey = f.key !== f.name || (f.aliases && f.aliases.length);
    if (needsJsonKey) {
      out += `    @JsonKey(name: '${f.key}') ${f.type}? ${f.name},\n`;
    } else {
      out += `    ${f.type}? ${f.name},\n`;
    }
  });
  out += `  }) = _${name};\n\n`;
  out += `  factory ${name}.fromJson(Map<String,dynamic> json) => _\$${name}FromJson(json);\n`;
  out += `}\n\n`;
  return out;
}

function buildFreezedModel(root) {
  let out = `import 'package:freezed_annotation/freezed_annotation.dart';\npart 'models.freezed.dart';\npart 'models.g.dart';\n\n`;
  out += `@JsonSerializable(explicitToJson: true)\n`;
  Object.keys(classes).forEach((c) => {
    out += buildFreezedClass(c, classes[c]);
  });
  return out;
}

$("#generate").click(() => {
  try {
    classes = {};
    let json = JSON.parse($("#jsonInput").val());
    let root = $("#rootClass").val() || "RootModel";
    let isArray = Array.isArray(json);
    let rootObj = isArray ? (json.length > 0 ? json[0] : {}) : json;
    parseObject(root, rootObj);
    let code = "";
    const fmt = $("#outputFormat").val();
    if (fmt === "freezed") {
      code = buildFreezedModel(root);
    } else {
      Object.keys(classes).forEach((c) => {
        code += buildClass(c, classes[c]);
      });
      if (isArray) {
        code = `// Root Type List<${root}>\n\n` + code;
      }
    }

    $("#output").text(code);
    $("#copyBtn").prop("disabled", !code.trim());
  } catch (e) {
    alert("Invalid JSON");
  }
});

// Copy generated code to clipboard
$("#copyBtn").click(async function () {
  const text = $("#output").text();
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    const $btn = $(this);
    const orig = $btn.text();
    $btn.text("Copied!");
    setTimeout(() => $btn.text(orig), 1500);
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      alert("Copy failed");
    }
    ta.remove();
  }
});
