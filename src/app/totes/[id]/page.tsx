import { InventoryApp } from "@/components/InventoryApp";
export default async function TotePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <InventoryApp initialToteId={id} />; }
