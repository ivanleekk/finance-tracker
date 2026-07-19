import api from "./api";

/** Downloads a file from an API endpoint that responds with Content-Disposition. */
export async function downloadFromApi(path: string): Promise<void> {
    const res = await api.get(path, { responseType: "blob" });
    const disposition: string | undefined = res.headers["content-disposition"];
    const filename = disposition?.match(/filename="?([^";]+)"?/)?.[1]
        ?? path.split("/").pop()
        ?? "download";
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
