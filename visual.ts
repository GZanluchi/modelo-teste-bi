import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import { Scene, PerspectiveCamera, WebGLRenderer, Color, AmbientLight, DirectionalLight, GridHelper, Raycaster, Vector2, Mesh, Material, Box3, Sphere, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { IFCLoader } from "web-ifc-three/IFCLoader";

interface Settings {
    defaultUrl: string;
    wasmPath: string;
    allowUpload: boolean;
    backgroundColor: string;
    modelColor: string;
    selectionColor: string;
    showGrid: boolean;
    showToolbar: boolean;
}

interface ElementBinding {
    key: string;
    selectionId: ISelectionId;
    tooltip: string;
    value?: number;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private root: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private toolbar: HTMLDivElement;
    private status: HTMLDivElement;
    private landing: HTMLDivElement;
    private input: HTMLInputElement;
    private scene: Scene;
    private camera: PerspectiveCamera;
    private renderer: WebGLRenderer;
    private controls: OrbitControls;
    private loader: IFCLoader;
    private raycaster = new Raycaster();
    private pointer = new Vector2();
    private grid: GridHelper;
    private model: any = null;
    private modelId: number | null = null;
    private lastUrl = "";
    private animationId = 0;
    private bindings = new Map<string, ElementBinding>();
    private settings: Settings = {
        defaultUrl: "",
        wasmPath: "https://unpkg.com/web-ifc@0.0.57/",
        allowUpload: true,
        backgroundColor: "#f3f5f7",
        modelColor: "#c9d4df",
        selectionColor: "#ff7a00",
        showGrid: true,
        showToolbar: true
    };

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.root = document.createElement("div");
        this.root.className = "ifc-root";
        this.canvas = document.createElement("canvas");
        this.canvas.className = "ifc-canvas";
        this.canvas.tabIndex = 0;
        this.toolbar = document.createElement("div");
        this.toolbar.className = "ifc-toolbar";
        this.status = document.createElement("div");
        this.status.className = "ifc-status";
        this.status.textContent = "Aguardando modelo IFC";
        this.landing = document.createElement("div");
        this.landing.className = "ifc-landing";
        this.landing.innerHTML = "<div><strong>IFC Viewer 3D</strong><br>Associe uma URL IFC ao campo ou use Carregar IFC.</div>";
        this.input = document.createElement("input");
        this.input.className = "ifc-file";
        this.input.type = "file";
        this.input.accept = ".ifc";
        this.toolbar.appendChild(this.makeButton("Carregar IFC", () => this.input.click()));
        this.toolbar.appendChild(this.makeButton("Enquadrar", () => this.fitModel()));
        this.toolbar.appendChild(this.makeButton("Limpar seleção", () => this.clearSelection()));
        this.toolbar.appendChild(this.input);
        this.root.append(this.canvas, this.toolbar, this.status, this.landing);
        options.element.appendChild(this.root);

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(55, 1, 0.1, 100000);
        this.camera.position.set(14, 10, 14);
        this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.scene.add(new AmbientLight(0xffffff, 1.2));
        const sun = new DirectionalLight(0xffffff, 1.4);
        sun.position.set(10, 20, 10);
        this.scene.add(sun);
        this.grid = new GridHelper(100, 100, 0x8b8b8b, 0xd4d4d4);
        this.scene.add(this.grid);
        this.loader = new IFCLoader();

        this.input.addEventListener("change", () => {
            const file = this.input.files && this.input.files[0];
            if (file) this.loadFile(file);
        });
        this.canvas.addEventListener("pointerdown", e => this.pick(e));
        this.animate();
    }

    public update(options: VisualUpdateOptions): void {
        this.readSettings(options.dataViews && options.dataViews[0]);
        this.scene.background = new Color(this.settings.backgroundColor);
        this.grid.visible = this.settings.showGrid;
        this.toolbar.style.display = this.settings.showToolbar ? "flex" : "none";
        (this.toolbar.firstElementChild as HTMLElement).style.display = this.settings.allowUpload ? "inline-block" : "none";
        this.resize(options.viewport.width, options.viewport.height);
        const url = this.readData(options.dataViews && options.dataViews[0]) || this.settings.defaultUrl;
        if (url && url !== this.lastUrl) {
            this.lastUrl = url;
            this.loadUrl(url);
        }
    }

    private readData(dataView?: DataView): string {
        this.bindings.clear();
        const categorical = dataView && dataView.categorical;
        if (!categorical || !categorical.categories) return "";
        const categories = categorical.categories;
        const urlCol = this.roleColumn(categories, "ifcUrl");
        const idCol = this.roleColumn(categories, "elementId");
        const tipCol = this.roleColumn(categories, "tooltip");
        const valueCol = categorical.values && categorical.values[0];
        if (idCol) {
            idCol.values.forEach((raw, i) => {
                const key = String(raw ?? "").trim();
                if (!key) return;
                const selectionId = this.host.createSelectionIdBuilder().withCategory(idCol, i).createSelectionId();
                this.bindings.set(key, {
                    key,
                    selectionId,
                    tooltip: tipCol ? String(tipCol.values[i] ?? key) : key,
                    value: valueCol && typeof valueCol.values[i] === "number" ? valueCol.values[i] as number : undefined
                });
            });
        }
        return urlCol && urlCol.values.length ? String(urlCol.values[0] ?? "") : "";
    }

    private roleColumn(columns: DataViewCategoryColumn[], role: string): DataViewCategoryColumn | undefined {
        return columns.find(c => !!(c.source.roles && c.source.roles[role]));
    }

    private async configureLoader(): Promise<void> {
        const api: any = this.loader.ifcManager.state.api;
        api["isWasmPathAbsolute"] = /^https?:\/\//i.test(this.settings.wasmPath);
        api["wasmPath"] = this.settings.wasmPath;
        this.loader.ifcManager.setWasmPath(this.settings.wasmPath, api["isWasmPathAbsolute"]);
    }

    private async loadUrl(url: string): Promise<void> {
        try {
            this.setStatus("Carregando IFC pela URL...");
            await this.configureLoader();
            const model = await this.loader.loadAsync(url);
            this.installModel(model);
        } catch (error) {
            this.fail("Não foi possível carregar a URL. Verifique CORS, HTTPS e o caminho do WASM.", error);
        }
    }

    private async loadFile(file: File): Promise<void> {
        try {
            this.setStatus(`Carregando ${file.name}...`);
            await this.configureLoader();
            const url = URL.createObjectURL(file);
            const model = await this.loader.loadAsync(url);
            URL.revokeObjectURL(url);
            this.installModel(model);
        } catch (error) {
            this.fail("Falha ao abrir o arquivo IFC.", error);
        } finally {
            this.input.value = "";
        }
    }

    private installModel(model: any): void {
        if (this.model) {
            this.scene.remove(this.model);
            this.disposeObject(this.model);
        }
        this.model = model;
        this.modelId = model.modelID;
        this.scene.add(model);
        this.landing.style.display = "none";
        this.fitModel();
        this.setStatus(`Modelo carregado. ${this.bindings.size} elementos associados aos dados.`);
    }

    private async pick(event: PointerEvent): Promise<void> {
        if (!this.model || this.modelId === null) return;
        const rect = this.canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit: any = this.raycaster.intersectObject(this.model, true)[0];
        if (!hit || !hit.faceIndex) return;
        const geometry: any = hit.object.geometry;
        const expressId = this.loader.ifcManager.getExpressId(geometry, hit.faceIndex);
        let globalId = "";
        try {
            const props: any = await this.loader.ifcManager.getItemProperties(this.modelId, expressId, false);
            globalId = props && props.GlobalId && (props.GlobalId.value || props.GlobalId) || "";
        } catch { /* Express ID remains available. */ }
        const binding = this.bindings.get(String(globalId)) || this.bindings.get(String(expressId));
        if (binding) {
            await this.selectionManager.select(binding.selectionId, event.ctrlKey || event.metaKey);
            this.setStatus(`${binding.tooltip} | Express ID: ${expressId}${globalId ? ` | GlobalId: ${globalId}` : ""}`);
        } else {
            await this.selectionManager.clear();
            this.setStatus(`Elemento sem vínculo | Express ID: ${expressId}${globalId ? ` | GlobalId: ${globalId}` : ""}`);
        }
    }

    private async clearSelection(): Promise<void> {
        await this.selectionManager.clear();
        this.setStatus(this.model ? "Seleção limpa." : "Aguardando modelo IFC");
    }

    private fitModel(): void {
        if (!this.model) return;
        const box = new Box3().setFromObject(this.model);
        const sphere = box.getBoundingSphere(new Sphere());
        if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return;
        const distance = sphere.radius / Math.sin((this.camera.fov * Math.PI / 180) / 2);
        this.camera.position.copy(sphere.center).add(new Vector3(distance * .7, distance * .55, distance * .7));
        this.camera.near = Math.max(distance / 10000, 0.01);
        this.camera.far = distance * 20;
        this.camera.updateProjectionMatrix();
        this.controls.target.copy(sphere.center);
        this.controls.update();
    }

    private resize(width: number, height: number): void {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    };

    private readSettings(dataView?: DataView): void {
        const objects: any = dataView && dataView.metadata && dataView.metadata.objects || {};
        const get = (object: string, property: string, fallback: any): any => {
            const value = objects[object] && objects[object][property];
            if (value && value.solid && value.solid.color) return value.solid.color;
            return value === undefined ? fallback : value;
        };
        this.settings = {
            defaultUrl: get("model", "defaultUrl", this.settings.defaultUrl),
            wasmPath: get("model", "wasmPath", this.settings.wasmPath),
            allowUpload: get("model", "allowUpload", true),
            backgroundColor: get("appearance", "backgroundColor", "#f3f5f7"),
            modelColor: get("appearance", "modelColor", "#c9d4df"),
            selectionColor: get("appearance", "selectionColor", "#ff7a00"),
            showGrid: get("appearance", "showGrid", true),
            showToolbar: get("appearance", "showToolbar", true)
        };
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        const card = (name: string, displayName: string, slices: any[]) => ({ name, displayName, slices });
        const descriptor = (objectName: string, propertyName: string) => ({ objectName, propertyName });
        const slice = (uid: string, displayName: string, descriptorValue: any, value: any, type: string) => ({
            uid, displayName, control: { type, properties: { descriptor: descriptorValue, value } }
        });
        return {
            cards: [
                card("model", "Modelo IFC", [
                    slice("defaultUrl", "URL padrão do IFC", descriptor("model", "defaultUrl"), this.settings.defaultUrl, "TextInput"),
                    slice("wasmPath", "Caminho do web-ifc.wasm", descriptor("model", "wasmPath"), this.settings.wasmPath, "TextInput"),
                    slice("allowUpload", "Permitir upload local", descriptor("model", "allowUpload"), this.settings.allowUpload, "ToggleSwitch")
                ]),
                card("appearance", "Aparência", [
                    slice("backgroundColor", "Fundo", descriptor("appearance", "backgroundColor"), { value: this.settings.backgroundColor }, "ColorPicker"),
                    slice("modelColor", "Cor padrão", descriptor("appearance", "modelColor"), { value: this.settings.modelColor }, "ColorPicker"),
                    slice("selectionColor", "Cor da seleção", descriptor("appearance", "selectionColor"), { value: this.settings.selectionColor }, "ColorPicker"),
                    slice("showGrid", "Mostrar grade", descriptor("appearance", "showGrid"), this.settings.showGrid, "ToggleSwitch"),
                    slice("showToolbar", "Mostrar barra de ferramentas", descriptor("appearance", "showToolbar"), this.settings.showToolbar, "ToggleSwitch")
                ])
            ]
        } as any;
    }

    private makeButton(label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.className = "ifc-button";
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", action);
        return button;
    }

    private setStatus(text: string): void { this.status.textContent = text; }
    private fail(message: string, error: unknown): void {
        console.error(message, error);
        this.landing.style.display = "flex";
        this.landing.innerHTML = `<div><strong>Erro ao carregar IFC</strong><br>${message}</div>`;
        this.setStatus(message);
    }

    private disposeObject(object: any): void {
        object.traverse((child: any) => {
            if (child.geometry) child.geometry.dispose();
            const materials: Material[] = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
            materials.forEach(m => m.dispose());
        });
    }

    public destroy(): void {
        cancelAnimationFrame(this.animationId);
        this.controls.dispose();
        if (this.model) this.disposeObject(this.model);
        this.renderer.dispose();
    }
}
