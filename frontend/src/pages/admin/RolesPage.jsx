import AdminPlaceholder from '../../components/admin/AdminPlaceholder.jsx'
import { ShieldIcon } from '../../components/ui/icons/index.js'

export default function RolesPage() {
  return (
    <AdminPlaceholder
      title="Roller"
      description="Sistemdeki rolleri ve yetki matrislerini yönetin."
      note="Rol yönetimi arayüzü bir sonraki aşamada burada yer alacak. Sunucu tarafı hazır: roller oluşturulabilir, yeniden adlandırılabilir ve silinebilir."
      Icon={ShieldIcon}
    />
  )
}
