/* eslint-disable */

import powerbi from "powerbi-visuals-api";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions =
    powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions =
    powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;

import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    Color,
    AmbientLight,
    DirectionalLight,
    GridHelper,
    Raycaster,
    Vector2,
    Vector3,
    Box3,
    Sphere,
    Material
} from "three";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { IFCLoader } from "web-ifc-three/IFCLoader";

interface VisualSettings {
    defaultUrl: string;
    wasmPath: string;
    allowUpload: boolean;
    backgroundColor: string;
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
    private fileInput: HTMLInputElement;

    private scene: Scene;
    private camera: PerspectiveCamera;
    private renderer: WebGLRenderer;
    private controls: OrbitControls;
    private grid: GridHelper;
    private loader: IFCLoader;

    private raycaster: Raycaster;
    private pointer: Vector2;

    private model: any = null;
    private modelId: number | null = null;
    private lastUrl = "";
    private animationId = 0;

    private bindings: Map<string, ElementBinding>;

    private settings: VisualSettings = {
        defaultUrl: "",
        wasmPath: "https://unpkg.com/web-ifc@0.0.57/",
        allowUpload: true,
        backgroundColor: "#f3f5f7",
        showGrid: true,
        showToolbar: true
    };

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.bindings = new Map<string, ElementBinding>();

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
        this.landing.innerHTML =
            "<div>" +
            "<strong>IFC Viewer 3D</strong><br>" +
            "Informe uma URL IFC ou selecione Carregar IFC." +
            "</div>";

        this.fileInput = document.createElement("input");
        this.fileInput.className = "ifc-file";
        this.fileInput.type = "file";
        this.fileInput.accept = ".ifc";

        const uploadButton = this.createButton(
            "Carregar IFC",
            (): void => {
                this.fileInput.click();
            }
        );

        const fitButton = this.createButton(
            "Enquadrar",
            (): void => {
                this.fitModel();
            }
        );

        const clearButton = this.createButton(
            "Limpar seleção",
            (): void => {
                void this.clearSelection();
            }
        );

        this.toolbar.appendChild(uploadButton);
        this.toolbar.appendChild(fitButton);
        this.toolbar.appendChild(clearButton);
        this.toolbar.appendChild(this.fileInput);

        this.root.appendChild(this.canvas);
        this.root.appendChild(this.toolbar);
        this.root.appendChild(this.status);
        this.root.appendChild(this.landing);

        options.element.appendChild(this.root);

        this.scene = new Scene();

        this.camera = new PerspectiveCamera(
            55,
            1,
            0.1,
            100000
        );

        this.camera.position.set(14, 10, 14);

        this.renderer = new WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });

        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, 2)
        );

        this.controls = new OrbitControls(
            this.camera,
            this.canvas
        );

        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;

        const ambientLight = new AmbientLight(
            0xffffff,
            1.2
        );

        const directionalLight = new DirectionalLight(
            0xffffff,
            1.4
        );

        directionalLight.position.set(10, 20, 10);

        this.scene.add(ambientLight);
        this.scene.add(directionalLight);

        this.grid = new GridHelper(
            100,
            100,
            0x808080,
            0xd4d4d4
        );

        this.scene.add(this.grid);

        this.loader = new IFCLoader();
        this.raycaster = new Raycaster();
        this.pointer = new Vector2();

        this.fileInput.addEventListener(
            "change",
            (): void => {
                const files = this.fileInput.files;

                if (!files || files.length === 0) {
                    return;
                }

                void this.loadLocalFile(files[0]);
            }
        );

        this.canvas.addEventListener(
            "pointerdown",
            (event: PointerEvent): void => {
                void this.selectElement(event);
            }
        );

        this.animate();
    }

    public update(options: VisualUpdateOptions): void {
        const dataView =
            options.dataViews &&
            options.dataViews.length > 0
                ? options.dataViews[0]
                : undefined;

        this.readSettings(dataView);
        this.readBindings(dataView);

        this.scene.background =
            new Color(this.settings.backgroundColor);

        this.grid.visible = this.settings.showGrid;

        this.toolbar.style.display =
            this.settings.showToolbar
                ? "flex"
                : "none";

        const uploadButton =
            this.toolbar.firstElementChild as HTMLElement;

        if (uploadButton) {
            uploadButton.style.display =
                this.settings.allowUpload
                    ? "inline-block"
                    : "none";
        }

        this.resize(
            options.viewport.width,
            options.viewport.height
        );

        const dataUrl = this.getIfcUrl(dataView);
        const url = dataUrl || this.settings.defaultUrl;

        if (url && url !== this.lastUrl) {
            this.lastUrl = url;
            void this.loadUrl(url);
        }
    }

    private getIfcUrl(
        dataView: DataView | undefined
    ): string {
        if (
            !dataView ||
            !dataView.categorical ||
            !dataView.categorical.categories
        ) {
            return "";
        }

        const urlColumn = this.findRoleColumn(
            dataView.categorical.categories,
            "ifcUrl"
        );

        if (
            !urlColumn ||
            !urlColumn.values ||
            urlColumn.values.length === 0
        ) {
            return "";
        }

        return String(urlColumn.values[0] || "").trim();
    }

    private readBindings(
        dataView: DataView | undefined
    ): void {
        this.bindings.clear();

        if (
            !dataView ||
            !dataView.categorical ||
            !dataView.categorical.categories
        ) {
            return;
        }

        const categorical = dataView.categorical;
        const categories = categorical.categories;

        const idColumn = this.findRoleColumn(
            categories,
            "elementId"
        );

        const tooltipColumn = this.findRoleColumn(
            categories,
            "tooltip"
        );

        const valueColumn =
            categorical.values &&
            categorical.values.length > 0
                ? categorical.values[0]
                : undefined;

        if (!idColumn) {
            return;
        }

        idColumn.values.forEach(
            (
                rawValue: powerbi.PrimitiveValue,
                index: number
            ): void => {
                const key = String(
                    rawValue === null ||
                    rawValue === undefined
                        ? ""
                        : rawValue
                ).trim();

                if (!key) {
                    return;
                }

                const selectionId =
                    this.host
                        .createSelectionIdBuilder()
                        .withCategory(idColumn, index)
                        .createSelectionId();

                const tooltip =
                    tooltipColumn &&
                    tooltipColumn.values[index] !== undefined
                        ? String(
                            tooltipColumn.values[index]
                        )
                        : key;

                const measureValue =
                    valueColumn &&
                    typeof valueColumn.values[index] === "number"
                        ? Number(
                            valueColumn.values[index]
                        )
                        : undefined;

                this.bindings.set(key, {
                    key,
                    selectionId,
                    tooltip,
                    value: measureValue
                });
            }
        );
    }

    private findRoleColumn(
        columns: DataViewCategoryColumn[],
        roleName: string
    ): DataViewCategoryColumn | undefined {
        return columns.find(
            (column: DataViewCategoryColumn): boolean => {
                return Boolean(
                    column.source.roles &&
                    column.source.roles[roleName]
                );
            }
        );
    }

    private configureLoader(): void {
        this.loader.ifcManager.setWasmPath(
            this.settings.wasmPath
        );
    }

    private loadIfcModel(url: string): Promise<any> {
        return new Promise(
            (
                resolve: (model: any) => void,
                reject: (reason?: any) => void
            ): void => {
                this.loader.load(
                    url,
                    (loadedModel: any): void => {
                        resolve(loadedModel);
                    },
                    undefined,
                    (error: any): void => {
                        reject(error);
                    }
                );
            }
        );
    }

    private async loadUrl(url: string): Promise<void> {
        try {
            this.setStatus(
                "Carregando modelo IFC pela URL..."
            );

            this.configureLoader();

            const loadedModel =
                await this.loadIfcModel(url);

            this.installModel(loadedModel);
        } catch (error) {
            this.showError(
                "Não foi possível carregar a URL. " +
                "Verifique HTTPS, CORS e o caminho do WASM.",
                error
            );
        }
    }

    private async loadLocalFile(
        file: File
    ): Promise<void> {
        let objectUrl = "";

        try {
            this.setStatus(
                "Carregando " + file.name + "..."
            );

            this.configureLoader();

            objectUrl = URL.createObjectURL(file);

            const loadedModel =
                await this.loadIfcModel(objectUrl);

            this.installModel(loadedModel);
        } catch (error) {
            this.showError(
                "Não foi possível abrir o arquivo IFC.",
                error
            );
        } finally {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }

            this.fileInput.value = "";
        }
    }

    private installModel(loadedModel: any): void {
        if (this.model) {
            this.scene.remove(this.model);
            this.disposeObject(this.model);
        }

        this.model = loadedModel;
        this.modelId = loadedModel.modelID;

        this.scene.add(loadedModel);

        this.landing.style.display = "none";

        this.fitModel();

        this.setStatus(
            "Modelo carregado. " +
            this.bindings.size +
            " elementos associados aos dados."
        );
    }

    private async selectElement(
        event: PointerEvent
    ): Promise<void> {
        if (!this.model || this.modelId === null) {
            return;
        }

        const rect = this.canvas.getBoundingClientRect();

        this.pointer.x =
            ((event.clientX - rect.left) / rect.width) *
                2 -
            1;

        this.pointer.y =
            -(
                (event.clientY - rect.top) /
                rect.height
            ) *
                2 +
            1;

        this.raycaster.setFromCamera(
            this.pointer,
            this.camera
        );

        const intersections =
            this.raycaster.intersectObject(
                this.model,
                true
            );

        if (intersections.length === 0) {
            return;
        }

        const intersection: any = intersections[0];

        if (
            intersection.faceIndex === undefined ||
            intersection.faceIndex === null
        ) {
            return;
        }

        const geometry =
            intersection.object.geometry;

        const expressId =
            this.loader.ifcManager.getExpressId(
                geometry,
                intersection.faceIndex
            );

        let globalId = "";

        try {
            const properties: any =
                await this.loader.ifcManager
                    .getItemProperties(
                        this.modelId,
                        expressId,
                        false
                    );

            if (
                properties &&
                properties.GlobalId
            ) {
                globalId = String(
                    properties.GlobalId.value ||
                    properties.GlobalId
                );
            }
        } catch (error) {
            globalId = "";
        }

        const binding =
            this.bindings.get(globalId) ||
            this.bindings.get(String(expressId));

        if (binding) {
            await this.selectionManager.select(
                binding.selectionId,
                event.ctrlKey || event.metaKey
            );

            let message =
                binding.tooltip +
                " | Express ID: " +
                expressId;

            if (globalId) {
                message +=
                    " | GlobalId: " + globalId;
            }

            this.setStatus(message);
        } else {
            await this.selectionManager.clear();

            let message =
                "Elemento sem vínculo | Express ID: " +
                expressId;

            if (globalId) {
                message +=
                    " | GlobalId: " + globalId;
            }

            this.setStatus(message);
        }
    }

    private async clearSelection(): Promise<void> {
        await this.selectionManager.clear();

        this.setStatus(
            this.model
                ? "Seleção limpa."
                : "Aguardando modelo IFC"
        );
    }

    private fitModel(): void {
        if (!this.model) {
            return;
        }

        const boundingBox =
            new Box3().setFromObject(this.model);

        const sphere =
            boundingBox.getBoundingSphere(
                new Sphere()
            );

        if (
            !Number.isFinite(sphere.radius) ||
            sphere.radius <= 0
        ) {
            return;
        }

        const fieldOfView =
            this.camera.fov * Math.PI / 180;

        const distance =
            sphere.radius /
            Math.sin(fieldOfView / 2);

        const offset = new Vector3(
            distance * 0.7,
            distance * 0.55,
            distance * 0.7
        );

        this.camera.position
            .copy(sphere.center)
            .add(offset);

        this.camera.near =
            Math.max(distance / 10000, 0.01);

        this.camera.far =
            Math.max(distance * 20, 1000);

        this.camera.updateProjectionMatrix();

        this.controls.target.copy(sphere.center);
        this.controls.update();
    }

    private resize(
        width: number,
        height: number
    ): void {
        const safeWidth = Math.max(1, width);
        const safeHeight = Math.max(1, height);

        this.renderer.setSize(
            safeWidth,
            safeHeight,
            false
        );

        this.camera.aspect =
            safeWidth / safeHeight;

        this.camera.updateProjectionMatrix();
    }

    private animate = (): void => {
        this.animationId =
            requestAnimationFrame(this.animate);

        this.controls.update();

        this.renderer.render(
            this.scene,
            this.camera
        );
    };

    private readSettings(
        dataView: DataView | undefined
    ): void {
        const objects: any =
            dataView &&
            dataView.metadata &&
            dataView.metadata.objects
                ? dataView.metadata.objects
                : {};

        const getValue = (
            objectName: string,
            propertyName: string,
            fallback: any
        ): any => {
            const object = objects[objectName];

            if (!object) {
                return fallback;
            }

            const value = object[propertyName];

            if (value === undefined) {
                return fallback;
            }

            if (
                value &&
                value.solid &&
                value.solid.color
            ) {
                return value.solid.color;
            }

            return value;
        };

        this.settings = {
            defaultUrl: getValue(
                "model",
                "defaultUrl",
                this.settings.defaultUrl
            ),
            wasmPath: getValue(
                "model",
                "wasmPath",
                this.settings.wasmPath
            ),
            allowUpload: getValue(
                "model",
                "allowUpload",
                true
            ),
            backgroundColor: getValue(
                "appearance",
                "backgroundColor",
                "#f3f5f7"
            ),
            showGrid: getValue(
                "appearance",
                "showGrid",
                true
            ),
            showToolbar: getValue(
                "appearance",
                "showToolbar",
                true
            )
        };
    }

    private createButton(
        label: string,
        action: () => void
    ): HTMLButtonElement {
        const button =
            document.createElement("button");

        button.className = "ifc-button";
        button.type = "button";
        button.textContent = label;

        button.addEventListener(
            "click",
            action
        );

        return button;
    }

    private setStatus(message: string): void {
        this.status.textContent = message;
    }

    private showError(
        message: string,
        error: unknown
    ): void {
        console.error(message, error);

        this.landing.style.display = "flex";

        this.landing.innerHTML =
            "<div>" +
            "<strong>Erro ao carregar IFC</strong><br>" +
            message +
            "</div>";

        this.setStatus(message);
    }

    private disposeObject(object: any): void {
        object.traverse((child: any): void => {
            if (child.geometry) {
                child.geometry.dispose();
            }

            const materials: Material[] =
                Array.isArray(child.material)
                    ? child.material
                    : child.material
                        ? [child.material]
                        : [];

            materials.forEach(
                (material: Material): void => {
                    material.dispose();
                }
            );
        });
    }

    public destroy(): void {
        cancelAnimationFrame(this.animationId);

        this.controls.dispose();

        if (this.model) {
            this.disposeObject(this.model);
        }

        this.renderer.dispose();
    }
}
