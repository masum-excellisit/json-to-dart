const sample = `REPLACE_JSON`;

// Minimal copy of the generator functions needed to emit Plain Dart classes
const classes = {};
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
    if (Object.keys(val).length === 0) return "Map<String,dynamic>";
    let cname = pascalCase(key);
    parseObject(cname, val);
    return cname;
  }
  return "dynamic";
}
function parseObject(className, obj) {
  if (!classes[className]) classes[className] = [];
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
      const existing = fieldsByName[fieldName];
      existing.aliases = existing.aliases || [];
      if (existing.key !== k && !existing.aliases.includes(k))
        existing.aliases.push(k);
      existing.type = mergeTypes(existing.type, newType);
    } else {
      fieldsByName[fieldName] = {
        key: k,
        name: fieldName,
        type: newType,
        aliases: [],
      };
    }
  }
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
    const source =
      f.aliases && f.aliases.length
        ? f.aliases.map((a) => `json['${a}']`).join(" ?? ") +
          ` ?? json['${f.key}']`
        : `json['${f.key}']`;
    if (f.type === "DateTime") {
      out += `      ${f.name}: (${source})!=null ? DateTime.parse((${source}).toString()) : null,\n`;
      return;
    }
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

function generateFromJson(jsonStr, rootName = "Product") {
  const obj = JSON.parse(jsonStr);
  const isArray = Array.isArray(obj);
  const rootObj = isArray ? (obj.length > 0 ? obj[0] : {}) : obj;
  parseObject(rootName, rootObj);
  let code = "";
  Object.keys(classes).forEach((c) => {
    code += buildClass(c, classes[c]);
  });
  if (isArray) {
    code = `// Root Type List<${rootName}>\n\n` + code;
  }
  return code;
}

// inject sample JSON
const json = `[
  {
    "id": 1,
    "title": "Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops",
    "price": 109.95,
    "description": "Your perfect pack for everyday use and walks in the forest. Stash your laptop (up to 15 inches) in the padded sleeve, your everyday",
    "category": "men's clothing",
    "image": "https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_t.png",
    "rating": {
      "rate": 3.9,
      "count": 120
    }
  },
  {
    "id": 2,
    "title": "Mens Casual Premium Slim Fit T-Shirts ",
    "price": 22.3,
    "description": "Slim-fitting style, contrast raglan long sleeve, three-button henley placket, light weight & soft fabric for breathable and comfortable wearing. And Solid stitched shirts with round neck made for durability and a great fit for casual fashion wear and diehard baseball fans. The Henley style round neckline includes a three-button placket.",
    "category": "men's clothing",
    "image": "https://fakestoreapi.com/img/71-3HjGNDUL._AC_SY879._SX._UX._SY._UY_t.png",
    "rating": {
      "rate": 4.1,
      "count": 259
    }
  },
  {
    "id": 3,
    "title": "Mens Cotton Jacket",
    "price": 55.99,
    "description": "great outerwear jackets for Spring/Autumn/Winter, suitable for many occasions, such as working, hiking, camping, mountain/rock climbing, cycling, traveling or other outdoors. Good gift choice for you or your family member. A warm hearted love to Father, husband or son in this thanksgiving or Christmas Day.",
    "category": "men's clothing",
    "image": "https://fakestoreapi.com/img/71li-ujtlUL._AC_UX679_t.png",
    "rating": {
      "rate": 4.7,
      "count": 500
    }
  },
  {
    "id": 4,
    "title": "Mens Casual Slim Fit",
    "price": 15.99,
    "description": "The color could be slightly different between on the screen and in practice. / Please note that body builds vary by person, therefore, detailed size information should be reviewed below on the product description.",
    "category": "men's clothing",
    "image": "https://fakestoreapi.com/img/71YXzeOuslL._AC_UY879_t.png",
    "rating": {
      "rate": 2.1,
      "count": 430
    }
  },
  {
    "id": 5,
    "title": "John Hardy Women's Legends Naga Gold & Silver Dragon Station Chain Bracelet",
    "price": 695,
    "description": "From our Legends Collection, the Naga was inspired by the mythical water dragon that protects the ocean's pearl. Wear facing inward to be bestowed with love and abundance, or outward for protection.",
    "category": "jewelery",
    "image": "https://fakestoreapi.com/img/71pWzhdJNwL._AC_UL640_QL65_ML3_t.png",
    "rating": {
      "rate": 4.6,
      "count": 400
    }
  },
  {
    "id": 6,
    "title": "Solid Gold Petite Micropave ",
    "price": 168,
    "description": "Satisfaction Guaranteed. Return or exchange any order within 30 days.Designed and sold by Hafeez Center in the United States. Satisfaction Guaranteed. Return or exchange any order within 30 days.",
    "category": "jewelery",
    "image": "https://fakestoreapi.com/img/61sbMiUnoGL._AC_UL640_QL65_ML3_t.png",
    "rating": {
      "rate": 3.9,
      "count": 70
    }
  },
  {
    "id": 7,
    "title": "White Gold Plated Princess",
    "price": 9.99,
    "description": "Classic Created Wedding Engagement Solitaire Diamond Promise Ring for Her. Gifts to spoil your love more for Engagement, Wedding, Anniversary, Valentine's Day...",
    "category": "jewelery",
    "image": "https://fakestoreapi.com/img/71YAIFU48IL._AC_UL640_QL65_ML3_t.png",
    "rating": {
      "rate": 3,
      "count": 400
    }
  },
  {
    "id": 8,
    "title": "Pierced Owl Rose Gold Plated Stainless Steel Double",
    "price": 10.99,
    "description": "Rose Gold Plated Double Flared Tunnel Plug Earrings. Made of 316L Stainless Steel",
    "category": "jewelery",
    "image": "https://fakestoreapi.com/img/51UDEzMJVpL._AC_UL640_QL65_ML3_t.png",
    "rating": {
      "rate": 1.9,
      "count": 100
    }
  },
  {
    "id": 9,
    "title": "WD 2TB Elements Portable External Hard Drive - USB 3.0 ",
    "price": 64,
    "description": "USB 3.0 and USB 2.0 Compatibility Fast data transfers Improve PC Performance High Capacity; Compatibility Formatted NTFS for Windows 10, Windows 8.1, Windows 7; Reformatting may be required for other operating systems; Compatibility may vary depending on user’s hardware configuration and operating system",
    "category": "electronics",
    "image": "https://fakestoreapi.com/img/61IBBVJvSDL._AC_SY879_t.png",
    "rating": {
      "rate": 3.3,
      "count": 203
    }
  },
  {
    "id": 10,
    "title": "SanDisk SSD PLUS 1TB Internal SSD - SATA III 6 Gb/s",
    "price": 109,
    "description": "Easy upgrade for faster boot up, shutdown, application load and response (As compared to 5400 RPM SATA 2.5” hard drive; Based on published specifications and internal benchmarking tests using PCMark vantage scores) Boosts burst write performance, making it ideal for typical PC workloads The perfect balance of performance and reliability Read/write speeds of up to 535MB/s/450MB/s (Based on internal testing; Performance may vary depending upon drive capacity, host device, OS and application.)",
    "category": "electronics",
    "image": "https://fakestoreapi.com/img/61U7T1koQqL._AC_SX679_t.png",
    "rating": {
      "rate": 2.9,
      "count": 470
    }
  },
  {
    "id": 11,
    "title": "Silicon Power 256GB SSD 3D NAND A55 SLC Cache Performance Boost SATA III 2.5",
    "price": 109,
    "description": "3D NAND flash are applied to deliver high transfer speeds Remarkable transfer speeds that enable faster bootup and improved overall system performance. The advanced SLC Cache Technology allows performance boost and longer lifespan 7mm slim design suitable for Ultrabooks and Ultra-slim notebooks. Supports TRIM command, Garbage Collection technology, RAID, and ECC (Error Checking & Correction) to provide the optimized performance and enhanced reliability.",
    "category": "electronics",
    "image": "https://fakestoreapi.com/img/71kWymZ+c+L._AC_SX679_t.png",
    "rating": {
      "rate": 4.8,
      "count": 319
    }
  },
  {
    "id": 12,
    "title": "WD 4TB Gaming Drive Works with Playstation 4 Portable External Hard Drive",
    "price": 114,
    "description": "Expand your PS4 gaming experience, Play anywhere Fast and easy, setup Sleek design with high capacity, 3-year manufacturer's limited warranty",
    "category": "electronics",
    "image": "https://fakestoreapi.com/img/61mtL65D4cL._AC_SX679_t.png",
    "rating": {
      "rate": 4.8,
      "count": 400
    }
  },
  {
    "id": 13,
    "title": "Acer SB220Q bi 21.5 inches Full HD (1920 x 1080) IPS Ultra-Thin",
    "price": 599,
    "description": "21. 5 inches Full HD (1920 x 1080) widescreen IPS display And Radeon free Sync technology. No compatibility for VESA Mount Refresh Rate: 75Hz - Using HDMI port Zero-frame design | ultra-thin | 4ms response time | IPS panel Aspect ratio - 16: 9. Color Supported - 16. 7 million colors. Brightness - 250 nit Tilt angle -5 degree to 15 degree 75 hertz",
    "category": "electronics",
    "image": "https://fakestoreapi.com/img/81QpkIctqPL._AC_SX679_t.png",
    "rating": {
      "rate": 2.9,
      "count": 250
    }
  },
  {
    "id": 14,
    "title": "Samsung 49-Inch CHG90 144Hz Curved Gaming Monitor (LC49HG90DMNXZA) – Super Ultrawide Screen QLED ",
    "price": 999.99,
    "description": "49 INCH SUPER ULTRAWIDE 32:9 CURVED GAMING MONITOR with dual 27 inch screen side by side QUANTUM DOT (QLED) TECHNOLOGY, HDR support and factory calibration provides stunningly realistic and accurate color and contrast 144HZ HIGH REFRESH RATE and 1ms ultra fast response time work to eliminate motion blur, ghosting, and reduce input lag",
    "category": "electronics",
    "image": "https://fakestoreapi.com/img/81Zt42ioCgL._AC_SX679_t.png",
    "rating": {
      "rate": 2.2,
      "count": 140
    }
  },
  {
    "id": 15,
    "title": "BIYLACLESEN Women's 3-in-1 Snowboard Jacket Winter Coats",
    "price": 56.99,
    "description": "Note:The Jackets is US standard size, Please choose size as your usual wear Material: 100% Polyester; Detachable Liner Fabric: Warm Fleece. Detachable Functional Liner: Skin Friendly, Lightweigt and Warm.Stand Collar Liner jacket, keep you warm in cold weather. Zippered Pockets: 2 Zippered Hand Pockets, 2 Zippered Pockets on Chest (enough to keep cards or keys)and 1 Hidden Pocket Inside.Zippered Hand Pockets and Hidden Pocket keep your things secure. Humanized Design: Adjustable and Detachable Hood and Adjustable cuff to prevent the wind and water,for a comfortable fit. 3 in 1 Detachable Design provide more convenience, you can separate the coat and inner as needed, or wear it together. It is suitable for different season and help you adapt to different climates",
    "category": "women's clothing",
    "image": "https://fakestoreapi.com/img/51Y5NI-I5jL._AC_UX679_t.png",
    "rating": {
      "rate": 2.6,
      "count": 235
    }
  },
  {
    "id": 16,
    "title": "Lock and Love Women's Removable Hooded Faux Leather Moto Biker Jacket",
    "price": 29.95,
    "description": "100% POLYURETHANE(shell) 100% POLYESTER(lining) 75% POLYESTER 25% COTTON (SWEATER), Faux leather material for style and comfort / 2 pockets of front, 2-For-One Hooded denim style faux leather jacket, Button detail on waist / Detail stitching at sides, HAND WASH ONLY / DO NOT BLEACH / LINE DRY / DO NOT IRON",
    "category": "women's clothing",
    "image": "https://fakestoreapi.com/img/81XH0e8fefL._AC_UY879_t.png",
    "rating": {
      "rate": 2.9,
      "count": 340
    }
  },
  {
    "id": 17,
    "title": "Rain Jacket Women Windbreaker Striped Climbing Raincoats",
    "price": 39.99,
    "description": "Lightweight perfet for trip or casual wear---Long sleeve with hooded, adjustable drawstring waist design. Button and zipper front closure raincoat, fully stripes Lined and The Raincoat has 2 side pockets are a good size to hold all kinds of things, it covers the hips, and the hood is generous but doesn't overdo it.Attached Cotton Lined Hood with Adjustable Drawstrings give it a real styled look.",
    "category": "women's clothing",
    "image": "https://fakestoreapi.com/img/71HblAHs5xL._AC_UY879_-2t.png",
    "rating": {
      "rate": 3.8,
      "count": 679
    }
  },
  {
    "id": 18,
    "title": "MBJ Women's Solid Short Sleeve Boat Neck V ",
    "price": 9.85,
    "description": "95% RAYON 5% SPANDEX, Made in USA or Imported, Do Not Bleach, Lightweight fabric with great stretch for comfort, Ribbed on sleeves and neckline / Double stitching on bottom hem",
    "category": "women's clothing",
    "image": "https://fakestoreapi.com/img/71z3kpMAYsL._AC_UY879_t.png",
    "rating": {
      "rate": 4.7,
      "count": 130
    }
  },
  {
    "id": 19,
    "title": "Opna Women's Short Sleeve Moisture",
    "price": 7.95,
    "description": "100% Polyester, Machine wash, 100% cationic polyester interlock, Machine Wash & Pre Shrunk for a Great Fit, Lightweight, roomy and highly breathable with moisture wicking fabric which helps to keep moisture away, Soft Lightweight Fabric with comfortable V-neck collar and a slimmer fit, delivers a sleek, more feminine silhouette and Added Comfort",
    "category": "women's clothing",
    "image": "https://fakestoreapi.com/img/51eg55uWmdL._AC_UX679_t.png",
    "rating": {
      "rate": 4.5,
      "count": 146
    }
  },
  {
    "id": 20,
    "title": "DANVOUY Womens T Shirt Casual Cotton Short",
    "price": 12.99,
    "description": "95%Cotton,5%Spandex, Features: Casual, Short Sleeve, Letter Print,V-Neck,Fashion Tees, The fabric is soft and has some stretch., Occasion: Casual/Office/Beach/School/Home/Street. Season: Spring,Summer,Autumn,Winter.",
    "category": "women's clothing",
    "image": "https://fakestoreapi.com/img/61pHAEJ4NML._AC_UX679_t.png",
    "rating": {
      "rate": 3.6,
      "count": 145
    }
  }
]`;
console.log(generateFromJson(json, "Product"));
