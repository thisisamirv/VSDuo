const fs = require("node:fs");
const path = require("node:path");
const { ZipFile } = require("yazl");

const repoRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const outArgIndex = process.argv.indexOf("--out");
const outPath = outArgIndex >= 0 && process.argv[outArgIndex + 1]
    ? path.resolve(repoRoot, process.argv[outArgIndex + 1])
    : path.join(repoRoot, `${packageJson.name}-${packageJson.version}.vsix`);

const zip = new ZipFile();
const packagedPaths = new Set();

for (const requiredPath of ["dist", "media", "README.md", "LICENSE", "package.json"]) {
    const absolutePath = path.join(repoRoot, requiredPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing required packaging input: ${requiredPath}`);
    }
}

ensureDirectory(path.dirname(outPath));

for (const filePath of walkDirectory(path.join(repoRoot, "dist"))) {
    const relative = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    zip.addFile(filePath, `extension/${relative}`);
}

for (const filePath of walkDirectory(path.join(repoRoot, "media"))) {
    const relative = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    zip.addFile(filePath, `extension/${relative}`);
}

for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    addDependencyTree(dependencyName);
}

zip.addFile(path.join(repoRoot, "package.json"), "extension/package.json");
zip.addFile(path.join(repoRoot, "README.md"), "extension/readme.md");
zip.addFile(path.join(repoRoot, "LICENSE"), "extension/LICENSE.txt");

zip.addBuffer(Buffer.from(renderVsixManifest(packageJson), "utf8"), "extension.vsixmanifest");
zip.addBuffer(Buffer.from(renderContentTypes(), "utf8"), "[Content_Types].xml");

const output = fs.createWriteStream(outPath);
zip.outputStream.pipe(output);
zip.end();

output.on("close", () => {
    console.log(`Packaged VSIX: ${outPath}`);
});

function walkDirectory(directoryPath) {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const fullPath = path.join(directoryPath, entry.name);
        return entry.isDirectory() ? walkDirectory(fullPath) : [fullPath];
    });
}

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function addDependencyTree(packageName) {
    const manifestPath = resolveDependencyManifestPath(packageName);
    if (packagedPaths.has(manifestPath)) {
        return;
    }

    packagedPaths.add(manifestPath);

    const packageRoot = path.dirname(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    addPackageDirectory(packageRoot);

    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
        addDependencyTree(dependencyName);
    }
}

function resolveDependencyManifestPath(packageName) {
    const entryPath = require.resolve(packageName, { paths: [repoRoot] });
    let currentDirectory = path.dirname(entryPath);

    while (currentDirectory !== path.dirname(currentDirectory)) {
        const candidate = path.join(currentDirectory, "package.json");
        if (fs.existsSync(candidate)) {
            const manifest = JSON.parse(fs.readFileSync(candidate, "utf8"));
            if (manifest.name === packageName) {
                return candidate;
            }
        }

        currentDirectory = path.dirname(currentDirectory);
    }

    throw new Error(`Unable to find package.json for dependency: ${packageName}`);
}

function addPackageDirectory(packageRoot) {
    for (const filePath of walkDirectory(packageRoot)) {
        const relative = path.relative(repoRoot, filePath).replace(/\\/g, "/");
        zip.addFile(filePath, `extension/${relative}`);
    }
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function renderVsixManifest(pkg) {
    const categories = Array.isArray(pkg.categories) ? pkg.categories.join(",") : "";
    const engine = pkg.engines && pkg.engines.vscode ? pkg.engines.vscode : "*";
    return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xmlEscape(pkg.name)}" Version="${xmlEscape(pkg.version)}" Publisher="${xmlEscape(pkg.publisher || "local")}" />
    <DisplayName>${xmlEscape(pkg.displayName || pkg.name)}</DisplayName>
    <Description xml:space="preserve">${xmlEscape(pkg.description || "")}</Description>
    <Tags></Tags>
    <Categories>${xmlEscape(categories)}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xmlEscape(engine)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>`;
}

function renderContentTypes() {
    return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".map" ContentType="application/json" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>`;
}