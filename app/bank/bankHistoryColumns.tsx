import { ColumnDef } from "@tanstack/react-table";
import { Button } from "~/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Fragment } from "react/jsx-runtime";

// Define the type for bank history
export type bankHistory = {
    bankName: string;
    currentBalance: number;
    latestDate: string;
    history: bankHistoryColumn[];
};

export type bankHistoryColumn = {
    bankName: string;
    history: bankHistory;
};

const MonthHeader = ({ month }: { month: string }) => {
    return <div className="min-w-10 text-center mx-4">{month}</div>;
}

// Define columns for the bank history table
export const bankHistoryColumns: ColumnDef<bankHistory>[] = [
    // Bank Name Column
    {
        header: ({ column }) => (
            <Button
                variant="tableHead"
                onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
                Bank
                <ArrowUpDown />
            </Button>
        ),
        accessorKey: "bankName",
    },

    // BF Column
    {
        header: () => <MonthHeader month="B/F from previous year" />,
        accessorKey: "history",
        id: "bf",
        cell: ({ row }) => {
            // get the lates value for the year
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            const selectedYear = new Date(temp[0].date).getFullYear() - 1;

            // sort the selected year
            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the year
            if (selectedYearData[0]) {
                return selectedYearData[0].balance;
            }
            return 'N/A';
            // return the balance if it exists
            // if (monthValue) {
            //     return monthValue.balance;
            // }
        },
    },

    // Jan Column
    {
        header: () => <MonthHeader month="Jan" />,
        accessorKey: "history",
        id: "jan",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 0;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Feb Column
    {
        header: () => <MonthHeader month="Feb" />,
        accessorKey: "history",
        id: "feb",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 1;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Mar Column
    {
        header: () => <MonthHeader month="Mar" />,
        accessorKey: "history",
        id: "mar",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 2;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Apr Column
    {
        header: () => <MonthHeader month="Apr" />,
        accessorKey: "history",
        id: "apr",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 3;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // May Column
    {
        header: () => <MonthHeader month="May" />,
        accessorKey: "history",
        id: "may",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 4;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Jun Column
    {
        header: () => <MonthHeader month="Jun" />,
        accessorKey: "history",
        id: "jun",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 5;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Jul Column
    {
        header: () => <MonthHeader month="Jul" />,
        accessorKey: "history",
        id: "jul",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 6;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Aug Column
    {
        header: () => <MonthHeader month="Aug" />,
        accessorKey: "history",
        id: "aug",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 7;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Sep Column
    {
        header: () => <MonthHeader month="Sep" />,
        accessorKey: "history",
        id: "sep",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 8;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Oct Column
    {
        header: () => <MonthHeader month="Oct" />,
        accessorKey: "history",
        id: "oct",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 9;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Nov Column
    {
        header: () => <MonthHeader month="Nov" />,
        accessorKey: "history",
        id: "nov",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 10;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },

    // Dec Column
    {
        header: () => <MonthHeader month="Dec" />,
        accessorKey: "history",
        cell: ({ row }) => {
            // get the latest value for the month
            // sort the data
            const temp = row.getValue("history").sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            })

            // filter the data
            const selectedYear = new Date(temp[0].date).getFullYear();

            // sort the selected year

            const selectedYearData = temp.filter((entry: any) => {
                return new Date(entry.date).getFullYear() === selectedYear;
            }).sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            // get the latest value for the month
            const monthValue = selectedYearData.find((entry: any) => {
                return new Date(entry.date).getMonth() === 11;
            });

            // return the balance if it exists
            if (monthValue) {
                return monthValue.balance;
            }
        },
    },
];
